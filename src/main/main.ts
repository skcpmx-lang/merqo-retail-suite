import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { openDatabase, closeDatabase } from './db';
import { registerIpc } from './ipc';
import { logger } from './logger';
import { getPaths } from './paths';
import { hardenContents, isAllowedPage, renderInHiddenWindow, renderPdfBuffer, withFonts } from './printService';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function rendererUrl(): string {
  if (isDev) return 'http://127.0.0.1:5174/';
  return `file://${path.join(__dirname, '../renderer/index.html')}`;
}

function isMainSender(contents: Electron.WebContents): boolean {
  return !!mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents;
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: 'MERQO Retail Suite',
    autoHideMenuBar: true,
    backgroundColor: '#f4f6fa',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  hardenContents(mainWindow.webContents, { allowDevServer: isDev });
  mainWindow.loadURL(rendererUrl());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------- Print service: hidden window renders document HTML, then print / PDF ----------

const MAX_PRINT_HTML = 3 * 1024 * 1024;

function checkedHtml(payload: unknown): string {
  const html = (payload as { html?: unknown })?.html;
  if (typeof html !== 'string' || html.length === 0 || html.length > MAX_PRINT_HTML) {
    throw new Error('bad print payload');
  }
  return html;
}

function checkedPrinterName(payload: unknown): string | undefined {
  const n = (payload as { printerName?: unknown })?.printerName;
  if (n === undefined || n === null || n === '') return undefined;
  if (typeof n !== 'string' || n.length > 260) throw new Error('bad printer name');
  return n;
}

function registerPrintIpc(): void {
  ipcMain.handle('merqo:printers', async (event) => {
    try {
      const contents = event.sender;
      const printers = await contents.getPrintersAsync();
      return { ok: true, data: printers.map((p) => ({ name: p.name, isDefault: p.isDefault, status: p.status })) };
    } catch (e) {
      logger.error('print', 'getPrinters failed', String(e));
      return { ok: false, error: 'PRINTER_UNAVAILABLE' };
    }
  });

  ipcMain.handle('merqo:print', async (event, payload: { html: string; printerName?: string; silent?: boolean; landscape?: boolean; paperWidthMicrons?: number }) => {
    let win: BrowserWindow | null = null;
    try {
      if (!isMainSender(event.sender)) return { ok: false, error: 'UNKNOWN_ACTION' };
      win = await renderInHiddenWindow(checkedHtml(payload));
      await new Promise((r) => setTimeout(r, 350)); // allow fonts/layout
      await new Promise<void>((resolve, reject) => {
        win!.webContents.print(
          {
            silent: payload.silent ?? false,
            printBackground: true,
            deviceName: checkedPrinterName(payload),
            landscape: payload.landscape ?? false,
          },
          (success, reason) => (success ? resolve() : reject(new Error(reason || 'print failed'))),
        );
      });
      return { ok: true };
    } catch (e) {
      logger.error('print', 'print failed', String(e));
      return { ok: false, error: 'PRINT_FAILED' };
    } finally {
      if (win && !win.isDestroyed()) win.close();
    }
  });

  ipcMain.handle('merqo:pdf', async (event, payload: { html: string; landscape?: boolean; pageSize?: string; widthMicrons?: number; heightMicrons?: number }) => {
    try {
      if (!isMainSender(event.sender)) return { ok: false, error: 'UNKNOWN_ACTION' };
      const paths = getPaths();
      const data = await renderPdfBuffer(checkedHtml(payload), { landscape: payload.landscape, pageSize: payload.pageSize });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = path.join(paths.exportDir, `merqo-doc-${stamp}.pdf`);
      fs.writeFileSync(file, data);
      return { ok: true, data: { file } };
    } catch (e) {
      logger.error('print', 'PDF failed', String(e));
      return { ok: false, error: 'PRINT_FAILED' };
    }
  });

  ipcMain.handle('merqo:preview', async (_event, payload: { html: string; title?: string }) => {
    try {
      const win = new BrowserWindow({
        width: 860,
        height: 1000,
        title: payload.title || 'প্রিভিউ',
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      });
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(withFonts(payload.html))}`);
      return { ok: true };
    } catch (e) {
      logger.error('print', 'preview failed', String(e));
      return { ok: false, error: 'PRINT_FAILED' };
    }
  });
}

// Release smoke modes (see src/main/smoke.ts). Handled before the single-instance
// lock so CI can run them deterministically on a clean machine.
const smokeOut = (() => {
  const i = process.argv.indexOf('--smoke-out');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
if (process.argv.includes('--merqo-smoke-gui')) {
  void import('./smoke').then((m) => m.runGuiSmoke(smokeOut ?? process.cwd()));
} else if (process.argv.includes('--merqo-smoke')) {
  void import('./smoke').then((m) => m.runHeadlessSmoke(smokeOut ?? process.cwd()));
}

// Single instance: protects the SQLite database from multi-process writes.
const gotLock = process.argv.includes('--merqo-smoke') || process.argv.includes('--merqo-smoke-gui') ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const isSmokeMode = process.argv.includes('--merqo-smoke') || process.argv.includes('--merqo-smoke-gui');

app.whenReady().then(() => {
  if (isSmokeMode) return; // smoke harness owns startup sequencing
  try {
    getPaths();
  } catch (e) {
    logger.error('startup', 'paths init failed', String(e));
  }
  try {
    openDatabase();
    logger.info('startup', 'database opened');
  } catch (e) {
    logger.error('startup', 'database open failed', String(e));
  }
  // Block all remote content — offline-first, no CDN at runtime.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    if (url.startsWith('data:') || url.startsWith('devtools://') || url.startsWith('chrome-extension://')) {
      callback({});
    } else if (url.startsWith('file://')) {
      // Only the app's own files may load.
      if (isAllowedPage(url, false)) callback({});
      else {
        logger.warn('security', `blocked file request: ${url.slice(0, 160)}`);
        callback({ cancel: true });
      }
    } else if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('ws://') || url.startsWith('wss://')) {
      // Dev server + vite HMR in dev only.
      if (isDev && (url.includes('127.0.0.1') || url.includes('localhost'))) callback({});
      else {
        logger.warn('security', `blocked remote request: ${url.slice(0, 120)}`);
        callback({ cancel: true });
      }
    } else {
      callback({});
    }
  });

  registerIpc();
  registerPrintIpc();
  createMainWindow();

  // Run business scan (notifications) shortly after startup
  setTimeout(() => {
    try {
      const { runBusinessScan } = require('./services/notificationService') as typeof import('./services/notificationService');
      const db = require('./db').getDb() as import('better-sqlite3').Database;
      const biz = db.prepare('SELECT id FROM businesses LIMIT 1').get() as { id: number } | undefined;
      if (biz) runBusinessScan(db as never, biz.id);
    } catch (e) {
      logger.warn('startup', 'business scan failed', String(e));
    }
  }, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    closeDatabase();
  } catch { /* noop */ }
});

process.on('uncaughtException', (e) => {
  logger.error('process', 'uncaughtException', String(e));
});
process.on('unhandledRejection', (e) => {
  logger.error('process', 'unhandledRejection', String(e));
});
