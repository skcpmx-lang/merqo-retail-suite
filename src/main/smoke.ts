/**
 * Packaged-app release smoke harness (§6–§8, §10-PDF, §16 of the release gate).
 *
 *  --merqo-smoke      headless: boots the REAL packaged main process (paths, SQLite,
 *                     migrations, seeds, logging) and runs a full business scenario
 *                     with hand-computed reconciliation assertions.
 *  --merqo-smoke-gui  additionally loads the REAL renderer in a window, captures
 *                     screenshots per route, fails on any console error, and renders
 *                     a Bengali PDF through the production print pipeline.
 *
 * Always uses an isolated temp userData dir — never touches real user data.
 */
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getDb, openDatabase, closeDatabase, integrityCheck } from './db';
import { getPaths } from './paths';
import { logger } from './logger';
import { renderPdfBuffer } from './printService';
import { runSetup, permissionsFor } from './services/authService';
import { createProduct } from './services/productService';
import { completeSale, createSaleReturn, getSaleDetail } from './services/salesService';
import { completePurchase, createPurchaseReturn, getPurchaseDetail } from './services/purchaseService';
import { createCustomer, createSupplier, receiveCustomerPayment, paySupplier } from './services/partyService';
import { transfer, createExpense, listAccounts } from './services/accountService';
import { createMfsTransaction } from './services/mfsService';
import { incomeExpense } from './services/reportService';
import { createBackup } from './services/backupService';
import { accountBalance, customerDue, supplierPayable, type Ctx } from './services/_helpers';

interface Step { name: string; ok: boolean; detail?: string }
interface SmokeReport {
  mode: string; ok: boolean; version: string; platform: string;
  steps: Step[]; error?: string; finishedAt: string;
}

function step(report: SmokeReport, name: string, detail?: string): void {
  report.steps.push({ name, ok: true, detail });
}

function expectEq(report: SmokeReport, name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`ASSERT FAIL [${name}]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  report.steps.push({ name, ok: true, detail: String(actual) });
}

export function useIsolatedUserData(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `merqo-${tag}-`));
  app.setPath('userData', dir);
  return dir;
}

export interface ScenarioResult {
  ctx: Ctx;
  token: string;
  invoiceNo: string;
  businessId: number;
}

/**
 * Full business scenario with independently hand-computed expectations.
 * Values: opening cash ৳50,000; product cost ৳50 / price ৳70 (pcs).
 */
export function runScenario(db: ReturnType<typeof getDb>, report: SmokeReport): ScenarioResult {
  const setup = runSetup(db, {
    business: { name: 'স্মোক টেস্ট ট্রেডার্স' },
    openingBalances: { CASH: 5000000 },
    admin: { name: 'মালিক', username: 'owner', password: 'Passw0rd!' },
    invoice: { prefix: 'MERQO' },
  });
  step(report, 'setup.run');
  const biz = setup.business; if (!biz) throw new Error('setup returned no business');
  const ctx: Ctx = { businessId: biz.id, userId: setup.user.id, permissions: permissionsFor(db, biz.id, 'owner') };

  const accounts = listAccounts(db, ctx);
  const cash = accounts.find((a) => a.code === 'CASH')!.id;
  const bank = accounts.find((a) => a.code === 'BANK')!.id;
  expectEq(report, 'seed.accounts', accounts.length, 8);

  const supplierId = createSupplier(db, ctx, { name: 'রহিম ট্রেডার্স', phone: '01700000001' });
  const customerId = createCustomer(db, ctx, { name: 'করিম মিয়া', phone: '01800000002' });
  step(report, 'party.create');
  const productId = createProduct(db, ctx, {
    name: 'চাল (মিনিকেট)', purchase_price: 5000, selling_price: 7000,
    opening_stock_milli: 5000, barcode: 'SMOKE001',
  });
  step(report, 'product.create');

  // Purchase 10 pcs @50 = 50000, pay 30000 -> due 20000. Stock 5+10=15.
  const po = completePurchase(db, ctx, {
    supplier_id: supplierId,
    items: [{ product_id: productId, qty_milli: 10000, unit_cost: 5000 }],
    payments: [{ account_id: cash, method: 'cash', amount: 30000 }],
  });
  expectEq(report, 'purchase.total', po.total, 50000);
  expectEq(report, 'purchase.due', po.due, 20000);

  // Sale 3 pcs @70 = 21000, pay 10000 -> due 11000. Stock 15-3=12.
  const sale = completeSale(db, ctx, {
    customer_id: customerId,
    items: [{ product_id: productId, qty_milli: 3000, unit_price: 7000 }],
    payments: [{ account_id: cash, method: 'cash', amount: 10000 }],
  });
  expectEq(report, 'sale.total', sale.total, 21000);
  expectEq(report, 'sale.due', sale.due, 11000);

  // Sale return 1 pc -> refund 7000, due 11000-7000=4000. Stock 12+1=13.
  const sDetail = getSaleDetail(db, ctx, sale.id);
  const ret = createSaleReturn(db, ctx, {
    sale_id: sale.id,
    items: [{ sale_item_id: (sDetail.items as { id: number }[])[0].id, qty_milli: 1000 }],
    account_id: cash,
  });
  expectEq(report, 'saleReturn.refund', ret.total_refund, 7000);

  // Customer pays remaining 4000 -> due 0.
  const cp = receiveCustomerPayment(db, ctx, { customer_id: customerId, account_id: cash, method: 'cash', amount: 4000 });
  expectEq(report, 'customer.remainingDue', cp.remaining_due, 0);

  // Purchase return 2 pcs -> credit 10000, due 20000-10000=10000. Stock 13-2=11.
  const pDetail = getPurchaseDetail(db, ctx, po.id);
  const pret = createPurchaseReturn(db, ctx, {
    purchase_id: po.id,
    items: [{ purchase_item_id: (pDetail.items as { id: number }[])[0].id, qty_milli: 2000 }],
  });
  expectEq(report, 'purchaseReturn.credit', pret.total_credit, 10000);

  // Supplier paid 10000 -> payable 0.
  const sp = paySupplier(db, ctx, { supplier_id: supplierId, account_id: cash, method: 'cash', amount: 10000 });
  expectEq(report, 'supplier.remainingPayable', sp.remaining_payable, 0);

  // Expense 5000 + transfer 10000 cash->bank + MFS cash-in 20000+400.
  const expCat = db.prepare("SELECT id FROM expense_categories WHERE business_id = ? LIMIT 1").get(ctx.businessId) as { id: number };
  createExpense(db, ctx, { category_id: expCat.id, amount: 5000, account_id: cash, description: 'যাতায়াত ভাড়া' });
  transfer(db, ctx, { from_account_id: cash, to_account_id: bank, amount: 10000, notes: 'ব্যাংকে জমা' });
  createMfsTransaction(db, ctx, { provider: 'bkash', txn_type: 'CASH_IN', amount: 20000, charge: 400, commission: 100, cash_account_id: cash });
  step(report, 'money.expense+transfer+mfs');

  // ---- Independent reconciliation ----
  const stock = (db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number }).stock_milli;
  expectEq(report, 'recon.stock', stock, 11000);
  expectEq(report, 'recon.customerDue', customerDue(db, ctx.businessId, customerId), 0);
  expectEq(report, 'recon.supplierPayable', supplierPayable(db, ctx.businessId, supplierId), 0);
  // Cash: 5000000 - (30000+7000+10000+5000+10000) + (10000+4000+20400)
  expectEq(report, 'recon.cash', accountBalance(db, ctx.businessId, cash), 5000000 - 62000 + 34400);
  expectEq(report, 'recon.bank', accountBalance(db, ctx.businessId, bank), 10000);
  const ie = incomeExpense(db, ctx, { from: '2000-01-01', to: '2100-01-01' }) as Record<string, number>;
  expectEq(report, 'recon.revenue', ie.revenue, 14000);
  expectEq(report, 'recon.cogs', ie.cogs, 10000);
  expectEq(report, 'recon.gross', ie.gross, 4000);
  expectEq(report, 'recon.expenses', ie.expenses, 5000);
  expectEq(report, 'recon.mfsCommission', ie.mfsCommission, 100);
  expectEq(report, 'recon.net', ie.net, -900);

  const bk = createBackup(db, ctx, 'smoke');
  if (!fs.existsSync(bk.file) || bk.size <= 0) throw new Error('backup file missing');
  step(report, 'backup.create', `${bk.size} bytes`);

  const integ = integrityCheck(db);
  expectEq(report, 'db.integrity', integ.ok, true);
  return { ctx, token: setup.token, invoiceNo: sale.invoice_no, businessId: ctx.businessId };
}

function newReport(mode: string): SmokeReport {
  return { mode, ok: false, version: app.getVersion(), platform: `${process.platform}-${process.arch}`, steps: [], finishedAt: '' };
}

function finish(report: SmokeReport, outDir: string, e?: unknown): number {
  report.finishedAt = new Date().toISOString();
  if (e) {
    report.ok = false;
    report.error = e instanceof Error ? `${e.message}` : String(e);
    report.steps.push({ name: 'FAILED', ok: false, detail: report.error });
  } else {
    report.ok = report.steps.every((s) => s.ok);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, report.mode === 'gui' ? 'gui-report.json' : 'smoke-report.json'), JSON.stringify(report, null, 2));
  // Windows GUI-subsystem exe has a detached stdout; a bare console.log can
  // raise EPIPE or leave stdout buffered when we immediately call app.exit.
  // We use a best-effort synchronous write and explicitly swallow EPIPE so the
  // process exit code reflects the scenario result, not a broken pipe.
  try {
    const out = JSON.stringify(report);
    if (process.stdout.writable) {
      try {
        // Write synchronously if possible; on some Electron builds stdout is non-blocking.
        process.stdout.write(out + '\n');
      } catch (err) {
        // Swallow EPIPE/EBADF which is expected for detached GUI stdout on Windows
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'EPIPE' && code !== 'EBADF' && code !== 'ERR_STREAM_WRITE_AFTER_END') {
          try { console.log(out); } catch { /* noop */ }
        }
      }
    } else {
      try { console.log(out); } catch { /* noop */ }
    }
  } catch { /* never fail report due to logging */ }
  return report.ok ? 0 : 1;
}

async function gracefulExit(code: number): Promise<void> {
  // Give Node/Electron a tick to flush file descriptors and the logger before terminating.
  // `app.exit` is immediate and bypasses before-quit, so we close DB ourselves first (caller does).
  await new Promise<void>((resolve) => setTimeout(resolve, 120));
  try {
    app.exit(code);
  } catch {
    process.exit(code);
  }
  // Belt-and-suspenders: if app.exit didn't terminate (e.g., in unit harness), force after a short timeout.
  setTimeout(() => process.exit(code), 900);
  // Keep event loop alive until exit fires.
  await new Promise(() => { /* never resolves; process will exit via app.exit/process.exit above */ });
}

export async function runHeadlessSmoke(outDir: string): Promise<void> {
  useIsolatedUserData('smoke');
  await app.whenReady();
  const report = newReport('headless');
  let code = 1;
  try {
    getPaths();
    step(report, 'paths.init', getPaths().userData);
    openDatabase();
    step(report, 'db.open');
    logger.info('smoke', 'headless smoke started');
    step(report, 'log.write');
    const db = getDb();
    runScenario(db, report);
    code = finish(report, outDir);
  } catch (e) {
    try { logger.error('smoke', 'headless smoke failed', String(e)); } catch { /* noop */ }
    try { console.error('[headless-smoke] failed', String(e)); } catch { /* noop */ }
    code = finish(report, outDir, e);
  }
  try { closeDatabase(); } catch { /* noop */ }
  await gracefulExit(code);
}

const GUI_ROUTES: { hash: string; shot: string }[] = [
  { hash: '#/', shot: 'dashboard.png' },
  { hash: '#/sales', shot: 'pos.png' },
  { hash: '#/products', shot: 'products.png' },
  { hash: '#/reports', shot: 'reports.png' },
  { hash: '#/settings', shot: 'settings.png' },
];

async function waitFor(win: BrowserWindow, fn: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    try {
      const v = await win.webContents.executeJavaScript(fn);
      if (v === true) return true;
    } catch { /* keep waiting */ }
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function runGuiSmoke(outDir: string): Promise<void> {
  useIsolatedUserData('smoke-gui');
  await app.whenReady();
  const report = newReport('gui');
  fs.mkdirSync(outDir, { recursive: true });
  let code = 1;
  try {
    getPaths();
    openDatabase();
    const db = getDb();
    const { token } = runScenario(db, report);
    step(report, 'gui.seed');

    const win = new BrowserWindow({
      width: 1440, height: 900, show: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    const consoleErrors: string[] = [];
    win.webContents.on('console-message', (_e, level, message) => {
      if (typeof level === 'number' && level >= 3) consoleErrors.push(`${message}`.slice(0, 300));
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      consoleErrors.push(`render-process-gone: ${details.reason}`);
    });

    const entry = `file://${path.join(__dirname, '../renderer/index.html')}`;
    await win.loadURL(entry);
    const ready = await waitFor(win, 'window.__MERQO_READY__ === true', 30000);
    if (!ready) throw new Error('renderer did not become ready (login)');
    step(report, 'gui.rendererReady');
    await new Promise((r) => setTimeout(r, 800));
    await saveShot(win, path.join(outDir, 'login.png'));
    step(report, 'gui.shot.login');

    // Log in with the real session token (main-process trusted channel).
    await win.webContents.executeJavaScript(
      `sessionStorage.setItem('merqo_token', ${JSON.stringify(token)}); location.hash = '#/'; location.reload();`,
    );
    const ready2 = await waitFor(win, 'window.__MERQO_READY__ === true', 30000);
    if (!ready2) throw new Error('renderer did not become ready (app)');
    step(report, 'gui.login');

    for (const r of GUI_ROUTES) {
      await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(r.hash)};`);
      await new Promise((res) => setTimeout(res, 1500));
      await saveShot(win, path.join(outDir, r.shot));
      step(report, `gui.shot.${r.shot}`);
    }

    // Production PDF pipeline with Bengali content + embedded fonts.
    const pdfHtml = `<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8"><style>/*__MQ_FONT__*/body{font-family:'Noto Sans Bengali',sans-serif;padding:40px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px}</style></head>`
      + `<body><h1>মার্কো রিটেইল স্যুট — চালান যাচাই</h1><p>তারিখ: ১৬ সেপ্টেম্বর ২০২৬ | ইনভয়েস: MERQO-2026-000001</p>`
      + `<table><tr><th>পণ্য</th><th>পরিমাণ</th><th>মোট</th></tr><tr><td>চাল (মিনিকেট)</td><td>২ কেজি</td><td>৳১৪০</td></tr></table></body></html>`;
    const pdf = await renderPdfBuffer(pdfHtml, { pageSize: 'A4' });
    const pdfFile = path.join(outDir, 'bengali-invoice.pdf');
    fs.writeFileSync(pdfFile, pdf);
    if (pdf.length < 5000) throw new Error(`PDF suspiciously small: ${pdf.length} bytes`);
    step(report, 'gui.pdf', `${pdf.length} bytes`);

    if (consoleErrors.length > 0) {
      throw new Error(`renderer console errors: ${consoleErrors.slice(0, 5).join(' | ')}`);
    }
    step(report, 'gui.noConsoleErrors');
    if (!win.isDestroyed()) win.close();
    code = finish(report, outDir);
  } catch (e) {
    try { console.error('[gui-smoke] failed', String(e)); } catch { /* noop */ }
    code = finish(report, outDir, e);
  }
  try { closeDatabase(); } catch { /* noop */ }
  await gracefulExit(code);
}

async function saveShot(win: BrowserWindow, file: string): Promise<void> {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
}
