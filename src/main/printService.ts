import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from './logger';

let fontCssCache: string | null = null;

/**
 * Print/preview windows load data: URLs, so bundled webfonts are unavailable.
 * Embed Noto Sans Bengali (OFL) as base64 @font-face so invoices/receipts/PDFs
 * always render Bengali correctly, offline.
 */
export function printFontCss(): string {
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

export function withFonts(html: string): string {
  return html.replace('/*__MQ_FONT__*/', printFontCss());
}

export function isAllowedPage(url: string, allowDevServer: boolean): boolean {
  if (allowDevServer && (url.startsWith('http://127.0.0.1:5174/') || url.startsWith('http://localhost:5174/'))) return true;
  if (url.startsWith('data:text/html')) return true; // print/preview windows
  if (url.startsWith('file://')) {
    const appRoot = path.resolve(app.getAppPath());
    const resRoot = process.resourcesPath ? path.resolve(process.resourcesPath) : '';
    try {
      // fileURLToPath() is the canonical conversion: on Windows it maps
      // file:///C:/... to C:\... (a bare new URL(url).pathname + path.resolve
      // yields "\C:\..." — a device-relative path — which never matched
      // appRoot, so the production request filter cancelled index.html and
      // every renderer asset: blank window on real installs).
      const filePath = path.resolve(fileURLToPath(url));
      if (filePath === appRoot || filePath.startsWith(appRoot + path.sep)) return true;
      if (resRoot && (filePath === resRoot || filePath.startsWith(resRoot + path.sep))) return true;
    } catch { return false; }
    return false;
  }
  return false;
}

export function hardenContents(contents: Electron.WebContents, opts: { allowDevServer: boolean }): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e, url) => {
    if (!isAllowedPage(url, opts.allowDevServer)) {
      e.preventDefault();
      logger.warn('security', `blocked navigation: ${url.slice(0, 160)}`);
    }
  });
  contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  if (app.isPackaged) {
    contents.on('devtools-opened', () => { try { contents.closeDevTools(); } catch { /* noop */ } });
  }
}

export async function renderInHiddenWindow(html: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  hardenContents(win.webContents, { allowDevServer: false });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(withFonts(html))}`);
  return win;
}

/** Render standalone document HTML to a PDF buffer (used by merqo:pdf and release smoke). */
export async function renderPdfBuffer(html: string, opts?: { landscape?: boolean; pageSize?: string }): Promise<Buffer> {
  let win: BrowserWindow | null = null;
  try {
    win = await renderInHiddenWindow(html);
    await new Promise((r) => setTimeout(r, 400));
    return await win.webContents.printToPDF({
      printBackground: true,
      landscape: opts?.landscape ?? false,
      pageSize: (opts?.pageSize as Electron.PrintToPDFOptions['pageSize']) ?? 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
  } finally {
    if (win && !win.isDestroyed()) win.close();
  }
}
