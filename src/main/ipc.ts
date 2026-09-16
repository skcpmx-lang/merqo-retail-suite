import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { getDb } from './db';
import { logger } from './logger';
import { AppError } from './services/_helpers';
import { ctxFromToken, destroySession, login, runSetup, isSetupComplete, changePassword, getBusiness } from './services/authService';
import * as products from './services/productService';
import * as sales from './services/salesService';
import * as purchases from './services/purchaseService';
import * as parties from './services/partyService';
import * as accounts from './services/accountService';
import * as mfs from './services/mfsService';
import * as users from './services/userService';
import * as reports from './services/reportService';
import * as notifs from './services/notificationService';
import * as backups from './services/backupService';
import * as impex from './services/importExportService';
import * as settings from './services/settingsService';

type Handler = (args: Record<string, never>, token?: string) => unknown | Promise<unknown>;

function auth(handler: (db: ReturnType<typeof getDb>, ctx: ReturnType<typeof ctxFromToken>, args: Record<string, never>) => unknown | Promise<unknown>): Handler {
  return (args, token) => {
    const db = getDb();
    const ctx = ctxFromToken(db, token);
    return handler(db, ctx, args ?? {});
  };
}

const routes: Record<string, Handler> = {
  // Setup & auth (no session needed)
  'setup.status': () => ({ complete: isSetupComplete(getDb()) }),
  'setup.run': (args) => runSetup(getDb(), (args as unknown as { payload: Parameters<typeof runSetup>[1] }).payload),
  'auth.login': (args) => {
    const { username, password } = args as unknown as { username: string; password: string };
    return login(getDb(), username, password);
  },
  'auth.logout': (_args, token) => { if (token) destroySession(token); return { ok: true }; },
  'auth.changePassword': auth((db, ctx, args) => {
    const { oldPassword, newPassword } = args as unknown as { oldPassword: string; newPassword: string };
    changePassword(db, ctx, oldPassword, newPassword);
    return { ok: true };
  }),
  'auth.me': auth((db, ctx) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.userId);
    return { business: getBusiness(db, ctx.businessId), permissions: ctx.permissions, user: row ? { ...(row as object), password_hash: undefined, password_salt: undefined } : null };
  }),

  // Products
  'product.create': auth((db, ctx, a) => ({ id: products.createProduct(db, ctx, (a as unknown as { input: Parameters<typeof products.createProduct>[2] }).input) })),
  'product.update': auth((db, ctx, a) => { const { id, input } = a as unknown as { id: number; input: Parameters<typeof products.updateProduct>[3] }; products.updateProduct(db, ctx, id, input); return { ok: true }; }),
  'product.delete': auth((db, ctx, a) => { products.deleteProduct(db, ctx, (a as unknown as { id: number }).id); return { ok: true }; }),
  'product.list': auth((db, ctx, a) => products.listProducts(db, ctx, (a as unknown as { opts: Parameters<typeof products.listProducts>[2] }).opts ?? {})),
  'product.get': auth((db, ctx, a) => products.getProductById(db, ctx, (a as unknown as { id: number }).id)),
  'product.barcode': auth((db, ctx, a) => products.findByBarcode(db, ctx, (a as unknown as { code: string }).code)),
  'product.search': auth((db, ctx, a) => products.searchProducts(db, ctx, (a as unknown as { q: string }).q ?? '', 30)),
  'master.list': auth((db, ctx, a) => products.listMaster(db, ctx, (a as unknown as { table: Parameters<typeof products.listMaster>[2] }).table)),
  'master.create': auth((db, ctx, a) => { const { table, name, extra } = a as unknown as { table: Parameters<typeof products.createMaster>[2]; name: string; extra?: Record<string, unknown> }; return { id: products.createMaster(db, ctx, table, name, extra) }; }),
  'master.rename': auth((db, ctx, a) => { const { table, id, name } = a as unknown as { table: Parameters<typeof products.renameMaster>[2]; id: number; name: string }; products.renameMaster(db, ctx, table, id, name); return { ok: true }; }),
  'master.delete': auth((db, ctx, a) => { const { table, id } = a as unknown as { table: Parameters<typeof products.deleteMaster>[2]; id: number }; products.deleteMaster(db, ctx, table, id); return { ok: true }; }),
  'stock.adjust': auth((db, ctx, a) => { const { productId, newMilli, reason } = a as unknown as { productId: number; newMilli: number; reason: string }; products.adjustStock(db, ctx, productId, newMilli, reason); return { ok: true }; }),
  'stock.damage': auth((db, ctx, a) => { const { productId, qtyMilli, type, reason } = a as unknown as { productId: number; qtyMilli: number; type: 'DAMAGE' | 'LOST'; reason: string }; products.recordDamageLoss(db, ctx, productId, qtyMilli, type, reason); return { ok: true }; }),
  'stock.count': auth((db, ctx, a) => { const { items, notes } = a as unknown as { items: { product_id: number; counted_milli: number }[]; notes?: string }; return { reference: products.saveStockCount(db, ctx, items, notes) }; }),
  'stock.movements': auth((db, ctx, a) => products.listMovements(db, ctx, (a as unknown as { opts: Parameters<typeof products.listMovements>[2] }).opts ?? {})),
  'stock.alerts': auth((db, ctx) => products.stockAlerts(db, ctx.businessId)),
  'batch.list': auth((db, ctx, a) => products.listBatches(db, ctx, (a as unknown as { productId: number }).productId)),
  'batch.add': auth((db, ctx, a) => { const { productId, batchNo, expiryDate, qtyMilli, unitCost } = a as unknown as { productId: number; batchNo: string | null; expiryDate: string | null; qtyMilli: number; unitCost: number }; products.addBatch(db, ctx, productId, batchNo, expiryDate, qtyMilli, unitCost); return { ok: true }; }),

  // Sales
  'sale.complete': auth((db, ctx, a) => sales.completeSale(db, ctx, (a as unknown as { input: Parameters<typeof sales.completeSale>[2] }).input)),
  'sale.completeHeld': auth((db, ctx, a) => { const { heldId, input } = a as unknown as { heldId: number; input: Parameters<typeof sales.completeSale>[2] }; return sales.completeSale(db, ctx, input, heldId); }),
  'sale.hold': auth((db, ctx, a) => sales.holdSale(db, ctx, (a as unknown as { input: Parameters<typeof sales.holdSale>[2] }).input)),
  'sale.heldList': auth((db, ctx) => sales.listHeld(db, ctx)),
  'sale.heldCancel': auth((db, ctx, a) => { sales.cancelHeld(db, ctx, (a as unknown as { id: number }).id); return { ok: true }; }),
  'sale.list': auth((db, ctx, a) => sales.listSales(db, ctx, (a as unknown as { opts: Parameters<typeof sales.listSales>[2] }).opts ?? {})),
  'sale.detail': auth((db, ctx, a) => sales.getSaleDetail(db, ctx, (a as unknown as { id: number }).id)),
  'sale.void': auth((db, ctx, a) => { const { id, reason } = a as unknown as { id: number; reason: string }; sales.voidSale(db, ctx, id, reason); return { ok: true }; }),
  'sale.return': auth((db, ctx, a) => sales.createSaleReturn(db, ctx, (a as unknown as { input: Parameters<typeof sales.createSaleReturn>[2] }).input)),
  'sale.returnList': auth((db, ctx, a) => sales.listSaleReturns(db, ctx, (a as unknown as { opts: Parameters<typeof sales.listSaleReturns>[2] }).opts ?? {})),

  // Purchases
  'purchase.complete': auth((db, ctx, a) => purchases.completePurchase(db, ctx, (a as unknown as { input: Parameters<typeof purchases.completePurchase>[2] }).input)),
  'purchase.list': auth((db, ctx, a) => purchases.listPurchases(db, ctx, (a as unknown as { opts: Parameters<typeof purchases.listPurchases>[2] }).opts ?? {})),
  'purchase.detail': auth((db, ctx, a) => purchases.getPurchaseDetail(db, ctx, (a as unknown as { id: number }).id)),
  'purchase.void': auth((db, ctx, a) => { const { id, reason } = a as unknown as { id: number; reason: string }; purchases.voidPurchase(db, ctx, id, reason); return { ok: true }; }),
  'purchase.return': auth((db, ctx, a) => purchases.createPurchaseReturn(db, ctx, (a as unknown as { input: Parameters<typeof purchases.createPurchaseReturn>[2] }).input)),
  'purchase.returnList': auth((db, ctx, a) => purchases.listPurchaseReturns(db, ctx, (a as unknown as { opts: Parameters<typeof purchases.listPurchaseReturns>[2] }).opts ?? {})),

  // Customers / suppliers
  'customer.create': auth((db, ctx, a) => ({ id: parties.createCustomer(db, ctx, (a as unknown as { input: Parameters<typeof parties.createCustomer>[2] }).input) })),
  'customer.update': auth((db, ctx, a) => { const { id, input } = a as unknown as { id: number; input: Parameters<typeof parties.updateCustomer>[3] }; parties.updateCustomer(db, ctx, id, input); return { ok: true }; }),
  'customer.list': auth((db, ctx, a) => parties.listCustomers(db, ctx, (a as unknown as { opts: Parameters<typeof parties.listCustomers>[2] }).opts ?? {})),
  'customer.profile': auth((db, ctx, a) => parties.getCustomerProfile(db, ctx, (a as unknown as { id: number }).id)),
  'customer.ledger': auth((db, ctx, a) => { const { id, opts } = a as unknown as { id: number; opts: Parameters<typeof parties.customerLedger>[3] }; return parties.customerLedger(db, ctx, id, opts ?? {}); }),
  'customer.pay': auth((db, ctx, a) => parties.receiveCustomerPayment(db, ctx, (a as unknown as { input: Parameters<typeof parties.receiveCustomerPayment>[2] }).input)),
  'customer.payments': auth((db, ctx, a) => parties.listCustomerPayments(db, ctx, (a as unknown as { opts: Parameters<typeof parties.listCustomerPayments>[2] }).opts ?? {})),
  'supplier.create': auth((db, ctx, a) => ({ id: parties.createSupplier(db, ctx, (a as unknown as { input: Parameters<typeof parties.createSupplier>[2] }).input) })),
  'supplier.update': auth((db, ctx, a) => { const { id, input } = a as unknown as { id: number; input: Parameters<typeof parties.updateSupplier>[3] }; parties.updateSupplier(db, ctx, id, input); return { ok: true }; }),
  'supplier.list': auth((db, ctx, a) => parties.listSuppliers(db, ctx, (a as unknown as { opts: Parameters<typeof parties.listSuppliers>[2] }).opts ?? {})),
  'supplier.profile': auth((db, ctx, a) => parties.getSupplierProfile(db, ctx, (a as unknown as { id: number }).id)),
  'supplier.ledger': auth((db, ctx, a) => { const { id, opts } = a as unknown as { id: number; opts: Parameters<typeof parties.supplierLedger>[3] }; return parties.supplierLedger(db, ctx, id, opts ?? {}); }),
  'supplier.pay': auth((db, ctx, a) => parties.paySupplier(db, ctx, (a as unknown as { input: Parameters<typeof parties.paySupplier>[2] }).input)),
  'supplier.payments': auth((db, ctx, a) => parties.listSupplierPayments(db, ctx, (a as unknown as { opts: Parameters<typeof parties.listSupplierPayments>[2] }).opts ?? {})),

  // Accounts & expenses
  'account.list': auth((db, ctx) => accounts.listAccounts(db, ctx)),
  'account.get': auth((db, ctx, a) => accounts.getAccount(db, ctx, (a as unknown as { id: number }).id)),
  'account.create': auth((db, ctx, a) => ({ id: accounts.createAccount(db, ctx, (a as unknown as { input: Parameters<typeof accounts.createAccount>[2] }).input) })),
  'account.update': auth((db, ctx, a) => { const { id, input } = a as unknown as { id: number; input: Parameters<typeof accounts.updateAccount>[3] }; accounts.updateAccount(db, ctx, id, input); return { ok: true }; }),
  'account.txns': auth((db, ctx, a) => { const { id, opts } = a as unknown as { id: number; opts: Parameters<typeof accounts.accountTransactions>[3] }; return accounts.accountTransactions(db, ctx, id, opts ?? {}); }),
  'account.transfer': auth((db, ctx, a) => accounts.transfer(db, ctx, (a as unknown as { input: Parameters<typeof accounts.transfer>[2] }).input)),
  'account.transfers': auth((db, ctx, a) => accounts.listTransfers(db, ctx, (a as unknown as { opts: Parameters<typeof accounts.listTransfers>[2] }).opts ?? {})),
  'expense.create': auth((db, ctx, a) => ({ id: accounts.createExpense(db, ctx, (a as unknown as { input: Parameters<typeof accounts.createExpense>[2] }).input) })),
  'expense.update': auth((db, ctx, a) => { const { id, input } = a as unknown as { id: number; input: Parameters<typeof accounts.updateExpense>[3] }; accounts.updateExpense(db, ctx, id, input); return { ok: true }; }),
  'expense.delete': auth((db, ctx, a) => { accounts.deleteExpense(db, ctx, (a as unknown as { id: number }).id); return { ok: true }; }),
  'expense.list': auth((db, ctx, a) => accounts.listExpenses(db, ctx, (a as unknown as { opts: Parameters<typeof accounts.listExpenses>[2] }).opts ?? {})),

  // MFS
  'mfs.create': auth((db, ctx, a) => mfs.createMfsTransaction(db, ctx, (a as unknown as { input: Parameters<typeof mfs.createMfsTransaction>[2] }).input)),
  'mfs.list': auth((db, ctx, a) => mfs.listMfsTransactions(db, ctx, (a as unknown as { opts: Parameters<typeof mfs.listMfsTransactions>[2] }).opts ?? {})),
  'mfs.summary': auth((db, ctx, a) => { const { from, to } = a as unknown as { from: string; to: string }; return mfs.mfsSummary(db, ctx, from, to); }),

  // Users & audit
  'user.list': auth((db, ctx, a) => users.listUsers(db, ctx, (a as unknown as { opts: Parameters<typeof users.listUsers>[2] }).opts ?? {})),
  'user.create': auth((db, ctx, a) => ({ id: users.createUser(db, ctx, (a as unknown as { input: Parameters<typeof users.createUser>[2] }).input) })),
  'user.update': auth((db, ctx, a) => { const { id, input } = a as unknown as { id: number; input: Parameters<typeof users.updateUser>[3] }; users.updateUser(db, ctx, id, input); return { ok: true }; }),
  'user.delete': auth((db, ctx, a) => { users.deleteUser(db, ctx, (a as unknown as { id: number }).id); return { ok: true }; }),
  'role.permissions': auth((db, ctx) => users.getRolePermissions(db, ctx)),
  'role.setPermissions': auth((db, ctx, a) => { const { role, permissions } = a as unknown as { role: string; permissions: string[] }; users.setRolePermissions(db, ctx, role, permissions); return { ok: true }; }),
  'audit.list': auth((db, ctx, a) => users.listAudit(db, ctx, (a as unknown as { opts: Parameters<typeof users.listAudit>[2] }).opts ?? {})),

  // Reports
  'report.dashboard': auth((db, ctx, a) => { const { dayFrom, dayTo, trendFrom, trendTo } = a as unknown as { dayFrom: string; dayTo: string; trendFrom: string; trendTo: string }; return reports.dashboard(db, ctx, dayFrom, dayTo, trendFrom, trendTo); }),
  'report.salesSummary': auth((db, ctx, a) => reports.salesSummary(db, ctx, (a as unknown as { f: Parameters<typeof reports.salesSummary>[2] }).f)),
  'report.salesByProduct': auth((db, ctx, a) => reports.salesByProduct(db, ctx, (a as unknown as { f: Parameters<typeof reports.salesByProduct>[2] }).f)),
  'report.salesByCategory': auth((db, ctx, a) => reports.salesByCategory(db, ctx, (a as unknown as { f: Parameters<typeof reports.salesByCategory>[2] }).f)),
  'report.salesByEmployee': auth((db, ctx, a) => reports.salesByEmployee(db, ctx, (a as unknown as { f: Parameters<typeof reports.salesByEmployee>[2] }).f)),
  'report.salesByPayment': auth((db, ctx, a) => reports.salesByPayment(db, ctx, (a as unknown as { f: Parameters<typeof reports.salesByPayment>[2] }).f)),
  'report.dueSales': auth((db, ctx, a) => reports.dueSales(db, ctx, (a as unknown as { f: Parameters<typeof reports.dueSales>[2] }).f ?? {})),
  'report.purchaseSummary': auth((db, ctx, a) => reports.purchaseSummary(db, ctx, (a as unknown as { f: Parameters<typeof reports.purchaseSummary>[2] }).f)),
  'report.purchaseBySupplier': auth((db, ctx, a) => reports.purchaseBySupplier(db, ctx, (a as unknown as { f: Parameters<typeof reports.purchaseBySupplier>[2] }).f)),
  'report.purchaseByProduct': auth((db, ctx, a) => reports.purchaseByProduct(db, ctx, (a as unknown as { f: Parameters<typeof reports.purchaseByProduct>[2] }).f)),
  'report.stockCurrent': auth((db, ctx, a) => reports.stockCurrent(db, ctx, (a as unknown as { f: Parameters<typeof reports.stockCurrent>[2] }).f ?? {})),
  'report.stockValuation': auth((db, ctx) => reports.stockValuation(db, ctx)),
  'report.expiry': auth((db, ctx, a) => reports.expiryReport(db, ctx, (a as unknown as { days: number }).days ?? 30)),
  'report.slowStock': auth((db, ctx, a) => reports.slowStock(db, ctx, (a as unknown as { days: number }).days ?? 90)),
  'report.incomeExpense': auth((db, ctx, a) => reports.incomeExpense(db, ctx, (a as unknown as { f: Parameters<typeof reports.incomeExpense>[2] }).f)),
  'report.cashflow': auth((db, ctx, a) => reports.cashflow(db, ctx, (a as unknown as { f: Parameters<typeof reports.cashflow>[2] }).f)),
  'report.accountBalances': auth((db, ctx) => reports.accountBalances(db, ctx)),
  'report.receivables': auth((db, ctx, a) => reports.receivables(db, ctx, (a as unknown as { f: Parameters<typeof reports.receivables>[2] }).f ?? {})),
  'report.payables': auth((db, ctx, a) => reports.payables(db, ctx, (a as unknown as { f: Parameters<typeof reports.payables>[2] }).f ?? {})),
  'report.profit': auth((db, ctx, a) => reports.profitReport(db, ctx, (a as unknown as { f: Parameters<typeof reports.profitReport>[2] }).f)),
  'search.global': auth((db, ctx, a) => reports.globalSearch(db, ctx, (a as unknown as { q: string }).q ?? '')),

  // Notifications
  'notif.list': auth((db, ctx, a) => notifs.listNotifications(db, ctx, (a as unknown as { opts: Parameters<typeof notifs.listNotifications>[2] }).opts ?? {})),
  'notif.read': auth((db, ctx, a) => { notifs.markRead(db, ctx, (a as unknown as { id: number }).id); return { ok: true }; }),
  'notif.readAll': auth((db, ctx) => { notifs.markAllRead(db, ctx); return { ok: true }; }),

  // Backup / system
  'backup.list': auth((db, ctx) => backups.listBackups(db, ctx)),
  'backup.create': auth((db, ctx, a) => backups.createBackup(db, ctx, (a as unknown as { note?: string }).note)),
  'backup.restore': auth((db, ctx, a) => backups.restoreBackup(db, ctx, (a as unknown as { file: string }).file)),
  'system.health': auth((db, ctx) => backups.systemHealth(db, ctx)),

  // Import/export
  'import.preview': auth((db, ctx, a) => { const { kind, file } = a as unknown as { kind: 'products' | 'customers' | 'suppliers'; file: string }; return impex.previewImport(db, ctx, kind, file); }),
  'import.confirm': auth((db, ctx, a) => { const { kind, rows } = a as unknown as { kind: 'products' | 'customers' | 'suppliers'; rows: Record<string, string>[] }; return impex.confirmImport(db, ctx, kind, rows); }),
  'import.template': (_a) => impex.downloadTemplate((_a as unknown as { kind: 'products' | 'customers' | 'suppliers' }).kind),
  'export.csv': auth((db, ctx, a) => { const { kind, from, to } = a as unknown as { kind: string; from?: string; to?: string }; return impex.exportCsv(db, ctx, kind, from, to); }),
  'export.excel': auth((db, ctx, a) => { const { kind, title, headers, rows } = a as unknown as { kind: string; title: string; headers: string[]; rows: unknown[][] }; return impex.exportExcel(db, ctx, kind, title, headers, rows); }),

  // Settings
  'business.profile': auth((db, ctx) => settings.getBusinessProfile(db, ctx)),
  'business.update': auth((db, ctx, a) => settings.updateBusinessProfile(db, ctx, (a as unknown as { input: Parameters<typeof settings.updateBusinessProfile>[2] }).input)),
  'settings.get': auth((db, ctx) => settings.getSettings(db, ctx)),
  'settings.set': auth((db, ctx, a) => { const { key, value } = a as unknown as { key: string; value: string }; settings.setSetting(db, ctx, key, value); return { ok: true }; }),
};

export function registerIpc(): void {
  ipcMain.handle('merqo:invoke', async (event, action: string, args: Record<string, never>, token?: string) => {
    const handler = routes[action];
    if (!handler) return { ok: false, error: 'UNKNOWN_ACTION' };
    try {
      const data = await handler(args ?? {}, token);
      return { ok: true, data };
    } catch (e) {
      if (e instanceof AppError) return { ok: false, error: e.code };
      logger.error('ipc', `action ${action} failed`, String(e));
      return { ok: false, error: 'DB_ERROR' };
    }
  });

  ipcMain.handle('merqo:dialog', async (event, kind: string, options?: Record<string, unknown>) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    try {
      if (kind === 'openFile') {
        const res = await dialog.showOpenDialog(win ?? (undefined as never), {
          properties: [(options?.multi ? 'multiSelections' : 'openFile') as 'openFile'],
          filters: (options?.filters as { name: string; extensions: string[] }[]) ?? [{ name: 'সব ফাইল', extensions: ['*'] }],
        });
        return { ok: true, data: res };
      }
      if (kind === 'saveFile') {
        const res = await dialog.showSaveDialog(win ?? (undefined as never), {
          defaultPath: (options?.defaultPath as string) ?? undefined,
          filters: (options?.filters as { name: string; extensions: string[] }[]) ?? undefined,
        });
        return { ok: true, data: res };
      }
      if (kind === 'openDir') {
        const res = await dialog.showOpenDialog(win ?? (undefined as never), { properties: ['openDirectory'] });
        return { ok: true, data: res };
      }
      return { ok: false, error: 'UNKNOWN_ACTION' };
    } catch (e) {
      logger.error('dialog', 'dialog failed', String(e));
      return { ok: false, error: 'DB_ERROR' };
    }
  });

  ipcMain.handle('merqo:shell', async (_event, action: string, target: string) => {
    try {
      if (action === 'openPath') {
        const err = await shell.openPath(target);
        return { ok: !err, error: err || undefined };
      }
      if (action === 'showItem') {
        shell.showItemInFolder(target);
        return { ok: true };
      }
      return { ok: false, error: 'UNKNOWN_ACTION' };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) };
    }
  });
}
