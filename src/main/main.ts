import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { openDatabase, closeDatabase } from './db';
import { registerIpc } from './ipc';
import { logger } from './logger';
import { getPaths } from './paths';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function rendererUrl(): string {
  if (isDev) return 'http://127.0.0.1:5174/';
  return `file://${path.join(__dirname, '../renderer/index.html')}`;
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
      sandbox: false,
    },
  });
  mainWindow.loadURL(rendererUrl());
  mainWindow.on('closed', () => { mainWindow = null; });
  if (isDev) {
    // Keep devtools closed by default; toggle with Ctrl+Shift+I
  }
}

// ---------- Print service: hidden window renders document HTML, then print / PDF ----------

let fontCssCache: string | null = null;

/**
 * Print/preview windows load data: URLs, so bundled webfonts are unavailable.
 * Embed Noto Sans Bengali (OFL) as base64 @font-face so invoices/receipts/PDFs
 * always render Bengali correctly, offline.
 */
function printFontCss(): string {
  if (fontCssCache !== null) return fontCssCache;
  const candidates = [
    path.join(process.resourcesPath || '', 'assets', 'fonts'),
    path.join(app.getAppPath(), '..', 'assets', 'fonts'),
    path.join(__dirname, '..', '..', 'assets', 'fonts'),
  ];
  for (const dir of candidates) {
    try {
      const r = path.join(dir, 'noto-sans-bengali-bengali-400-normal.woff2');
      const b = path.join(dir, 'noto-sans-bengali-bengali-700-normal.woff2');
      if (fs.existsSync(r) && fs.existsSync(b)) {
        const rb = fs.readFileSync(r).toString('base64');
        const bb = fs.readFileSync(b).toString('base64');
        fontCssCache = `@font-face{font-family:'Noto Sans Bengali';font-weight:400;font-style:normal;src:url(data:font/woff2;base64,${rb}) format('woff2');}`
          + `@font-face{font-family:'Noto Sans Bengali';font-weight:700;font-style:normal;src:url(data:font/woff2;base64,${bb}) format('woff2');}`;
        return fontCssCache;
      }
    } catch { /* try next */ }
  }
  logger.warn('print', 'bundled Bengali font not found; print output may fall back to system fonts');
  fontCssCache = '';
  return fontCssCache;
}

function withFonts(html: string): string {
  return html.replace('/*__MQ_FONT__*/', printFontCss());
}

async function renderInHiddenWindow(html: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(withFonts(html))}`);
  return win;
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

  ipcMain.handle('merqo:print', async (_event, payload: { html: string; printerName?: string; silent?: boolean; landscape?: boolean; paperWidthMicrons?: number }) => {
    let win: BrowserWindow | null = null;
    try {
      win = await renderInHiddenWindow(payload.html);
      await new Promise((r) => setTimeout(r, 350)); // allow fonts/layout
      await new Promise<void>((resolve, reject) => {
        win!.webContents.print(
          {
            silent: payload.silent ?? false,
            printBackground: true,
            deviceName: payload.printerName || undefined,
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

  ipcMain.handle('merqo:pdf', async (_event, payload: { html: string; landscape?: boolean; pageSize?: string; widthMicrons?: number; heightMicrons?: number }) => {
    let win: BrowserWindow | null = null;
    try {
      const paths = getPaths();
      win = await renderInHiddenWindow(payload.html);
      await new Promise((r) => setTimeout(r, 350));
      const pdfOptions: Electron.PrintToPDFOptions = {
        printBackground: true,
        landscape: payload.landscape ?? false,
        pageSize: (payload.pageSize as Electron.PrintToPDFOptions['pageSize']) ?? 'A4',
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      };
      const data = await win.webContents.printToPDF(pdfOptions);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = path.join(paths.exportDir, `merqo-doc-${stamp}.pdf`);
      fs.writeFileSync(file, data);
      return { ok: true, data: { file } };
    } catch (e) {
      logger.error('print', 'PDF failed', String(e));
      return { ok: false, error: 'PRINT_FAILED' };
    } finally {
      if (win && !win.isDestroyed()) win.close();
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

app.whenReady().then(() => {
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
    if (url.startsWith('http://127.0.0.1:5174/') || url.startsWith('file://') || url.startsWith('data:') || url.startsWith('devtools://') || url.startsWith('chrome-extension://')) {
      callback({});
    } else if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('ws://') || url.startsWith('wss://')) {
      // Allow vite HMR websocket in dev only
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
