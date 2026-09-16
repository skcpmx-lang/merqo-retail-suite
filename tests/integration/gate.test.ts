/**
 * Release-gate tests (§8 partial, §13–§19):
 * error matrix, service-layer permission enforcement, audit trail, backup/restore
 * round-trip, import/export with Bengali data, login throttle, performance floor.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openIsolatedDatabase, openDatabase, closeDatabase, integrityCheck, type Db,
} from '../../src/main/db';
import { setUserDataRoot } from '../../src/main/paths';
import { AppError, type Ctx } from '../../src/main/services/_helpers';
import { runSetup, login, permissionsFor } from '../../src/main/services/authService';
import { createProduct, updateProduct, searchProducts, listProducts, adjustStock } from '../../src/main/services/productService';
import { completeSale, voidSale, createSaleReturn } from '../../src/main/services/salesService';
import { createCustomer, createSupplier, receiveCustomerPayment } from '../../src/main/services/partyService';
import { transfer, createExpense, listAccounts } from '../../src/main/services/accountService';
import { createUser, setRolePermissions } from '../../src/main/services/userService';
import { createBackup, restoreBackup } from '../../src/main/services/backupService';
import { previewImport, confirmImport, exportCsv } from '../../src/main/services/importExportService';
import { incomeExpense } from '../../src/main/services/reportService';
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../../src/shared/constants';

let db: Db;
let tmpRoot: string;
let ctx: Ctx;
let businessId: number;
let productId: number;
let customerId: number;
let supplierId: number;
let cashId: number;

const codeOf = (fn: () => unknown): string => {
  try { fn(); } catch (e) { return (e as AppError).code; }
  throw new Error('expected AppError, none thrown');
};

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merqo-gate-'));
  setUserDataRoot(path.join(tmpRoot, 'userdata'));
  db = openIsolatedDatabase(path.join(tmpRoot, 'gate.db'));
  const s = runSetup(db, {
    business: { name: 'গেট টেস্ট' },
    openingBalances: { CASH: 10000000 },
    admin: { name: 'মালিক', username: 'gateowner', password: 'Passw0rd!' },
  });
  businessId = s.business!.id;
  ctx = { businessId, userId: s.user.id, permissions: [...PERMISSIONS] };
  cashId = listAccounts(db, ctx).find((a) => a.code === 'CASH')!.id;
  supplierId = createSupplier(db, ctx, { name: 'গেট সাপ্লায়ার' });
  customerId = createCustomer(db, ctx, { name: 'গেট কাস্টমার' });
  productId = createProduct(db, ctx, {
    name: 'গেট পণ্য', purchase_price: 5000, selling_price: 7000,
    opening_stock_milli: 10000, sku: 'GATE-SKU-1', barcode: 'GATE-BC-1',
  });
});

afterAll(() => {
  try { db.close(); } catch { /* noop */ }
  try { closeDatabase(); } catch { /* noop */ }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('error matrix (§13)', () => {
  it('rejects duplicate SKU and barcode', () => {
    expect(codeOf(() => createProduct(db, ctx, { name: 'x', purchase_price: 1, selling_price: 2, sku: 'GATE-SKU-1' }))).toBe('SKU_DUPLICATE');
    expect(codeOf(() => createProduct(db, ctx, { name: 'x', purchase_price: 1, selling_price: 2, barcode: 'GATE-BC-1' }))).toBe('BARCODE_DUPLICATE');
  });
  it('rejects invalid price, qty and empty names', () => {
    expect(codeOf(() => createProduct(db, ctx, { name: 'x', purchase_price: -5, selling_price: 2 }))).toBe('INVALID_PRICE');
    expect(codeOf(() => createProduct(db, ctx, { name: '   ', purchase_price: 1, selling_price: 2 }))).toBe('REQUIRED');
    expect(codeOf(() => createCustomer(db, ctx, { name: '' }))).toBe('REQUIRED');
    expect(codeOf(() => completeSale(db, ctx, {
      items: [{ product_id: productId, qty_milli: 0, unit_price: 7000 }],
      payments: [{ account_id: cashId, method: 'cash', amount: 1 }],
    }))).toBe('INVALID_QTY');
  });
  it('blocks insufficient stock and walk-in overpayment', () => {
    expect(codeOf(() => completeSale(db, ctx, {
      items: [{ product_id: productId, qty_milli: 999999999, unit_price: 7000 }],
      payments: [{ account_id: cashId, method: 'cash', amount: 999999999 * 7 }],
    }))).toBe('NEGATIVE_STOCK_BLOCKED');
    // walk-in overpay becomes change, not an error — but customer overpay with block policy errors
    expect(codeOf(() => completeSale(db, ctx, {
      customer_id: customerId,
      items: [{ product_id: productId, qty_milli: 1000, unit_price: 7000 }],
      payments: [{ account_id: cashId, method: 'cash', amount: 8000 }],
    }))).toBe('OVERPAYMENT_BLOCKED');
  });
  it('rejects payment to unknown account', () => {
    expect(codeOf(() => receiveCustomerPayment(db, ctx, { customer_id: customerId, account_id: 9999, method: 'cash', amount: 100 }))).toBe('ACCOUNT_NOT_FOUND');
  });
  it('rejects restoring a non-database file', () => {
    expect(codeOf(() => restoreBackup(db, ctx, __filename))).toBe('BACKUP_INVALID');
  });
});

describe('crash/interruption safety (§18)', () => {
  it('rolls back the whole sale when money posting fails mid-transaction', () => {
    const before = (db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number }).stock_milli;
    const salesBefore = (db.prepare('SELECT COUNT(*) AS c FROM sales').get() as { c: number }).c;
    // valid stock line, but payment references a missing account -> must fail atomically
    expect(codeOf(() => completeSale(db, ctx, {
      customer_id: customerId,
      items: [{ product_id: productId, qty_milli: 1000, unit_price: 7000 }],
      payments: [{ account_id: 424242, method: 'cash', amount: 7000 }],
    }))).toBe('ACCOUNT_NOT_FOUND');
    const after = (db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number }).stock_milli;
    const salesAfter = (db.prepare('SELECT COUNT(*) AS c FROM sales').get() as { c: number }).c;
    expect(after).toBe(before);
    expect(salesAfter).toBe(salesBefore);
  });
});

describe('service-layer permissions (§14)', () => {
  const ids: Record<string, number> = {};
  beforeAll(() => {
    for (const r of ['manager', 'cashier', 'sales', 'inventory', 'accountant']) {
      ids[r] = createUser(db, ctx, { name: `গেট ${r}`, username: `gate_${r}`, password: 'Passw0rd!', role: r });
    }
  });
  const roleCtx = (role: string): Ctx => ({ businessId, userId: ids[role], permissions: permissionsFor(db, businessId, role) });
  it('denies cashier destructive/admin actions even when called directly', () => {
    const c = roleCtx('cashier');
    expect(codeOf(() => voidSale(db, c, 1, 'x'))).toBe('NO_PERMISSION');
    expect(codeOf(() => createUser(db, c, { name: 'h', username: 'hx', password: 'Passw0rd!', role: 'cashier' }))).toBe('NO_PERMISSION');
    expect(codeOf(() => createBackup(db, c))).toBe('NO_PERMISSION');
    expect(codeOf(() => adjustStock(db, c, productId, 1000, 'x'))).toBe('NO_PERMISSION');
    expect(codeOf(() => transfer(db, c, { from_account_id: cashId, to_account_id: cashId, amount: 1 }))).toBe('NO_PERMISSION');
  });
  it('denies cross-role actions: sales/inventory/accountant/manager', () => {
    expect(codeOf(() => createProduct(db, roleCtx('sales'), { name: 'x', purchase_price: 1, selling_price: 2 }))).toBe('NO_PERMISSION');
    expect(codeOf(() => completeSale(db, roleCtx('inventory'), {
      items: [{ product_id: productId, qty_milli: 100, unit_price: 7000 }],
      payments: [{ account_id: cashId, method: 'cash', amount: 700 }],
    }))).toBe('NO_PERMISSION');
    expect(codeOf(() => voidSale(db, roleCtx('accountant'), 1, 'x'))).toBe('NO_PERMISSION');
    expect(codeOf(() => setRolePermissions(db, roleCtx('manager'), 'cashier', ['sale.create']))).toBe('NO_PERMISSION');
  });
  it('allows in-role actions', () => {
    // inventory staff may adjust stock; accountant may transfer; manager may sell
    adjustStock(db, roleCtx('inventory'), productId, 10000, 'গেট অনুমোদিত সমন্বয়');
    transfer(db, roleCtx('accountant'), { from_account_id: cashId, to_account_id: cashId === 1 ? 2 : 1, amount: 100 });
    const s = completeSale(db, roleCtx('manager'), {
      items: [{ product_id: productId, qty_milli: 100, unit_price: 7000 }],
      payments: [{ account_id: cashId, method: 'cash', amount: 700 }],
    });
    expect(s.total).toBe(700);
    expect(DEFAULT_ROLE_PERMISSIONS.owner.length).toBe(PERMISSIONS.length);
  });
});

describe('audit trail (§15)', () => {
  it('records every sensitive operation', () => {
    const sale = completeSale(db, ctx, {
      customer_id: customerId,
      items: [{ product_id: productId, qty_milli: 500, unit_price: 7000 }],
      payments: [{ account_id: cashId, method: 'cash', amount: 3500 }],
    });
    updateProduct(db, ctx, productId, { selling_price: 7500 });
    adjustStock(db, ctx, productId, 20000, 'অডিট সমন্বয়');
    receiveCustomerPayment(db, ctx, { customer_id: customerId, account_id: cashId, method: 'cash', amount: 100 });
    const expCat = db.prepare('SELECT id FROM expense_categories WHERE business_id = ? LIMIT 1').get(businessId) as { id: number };
    createExpense(db, ctx, { category_id: expCat.id, amount: 250, account_id: cashId, description: 'অডিট খরচ' });
    voidSale(db, ctx, sale.id, 'অডিট বাতিল পরীক্ষা');
    setRolePermissions(db, ctx, 'cashier', ['sale.create', 'sale.reprint', 'customer.create', 'report.sales']);
    const rows = db.prepare("SELECT DISTINCT action FROM audit_logs WHERE business_id = ?").all(businessId) as { action: string }[];
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['sale.complete', 'product.price_change', 'inventory.adjust', 'customer.payment', 'expense.create', 'sale.void', 'permission.update']) {
      expect(actions.has(a)).toBe(true);
    }
  });
});

describe('import/export with Bengali data (§17)', () => {
  it('flags invalid rows and imports only valid ones', () => {
    const csv = '﻿name,sku,barcode,category,brand,unit,purchase_price,selling_price,opening_stock,min_stock\n'
      + 'ডাল (মসুর),GATE-IMP-1,,মুদি,,পিস,60,80,10,2\n'
      + ',GATE-IMP-BAD,,মুদি,,পিস,10,12,1,0\n'
      + 'ভুল দাম,GATE-IMP-BAD2,,মুদি,,পিস,abc,12,1,0\n';
    const file = path.join(tmpRoot, 'import.csv');
    fs.writeFileSync(file, csv, 'utf8');
    const preview = previewImport(db, ctx, 'products', file);
    expect(preview.validCount).toBe(1);
    expect(preview.errors.length).toBe(2);
    const res = confirmImport(db, ctx, 'products', preview.rows);
    expect(res.imported).toBe(1);
    const got = db.prepare('SELECT name FROM products WHERE sku = ?').get('GATE-IMP-1') as { name: string };
    expect(got.name).toBe('ডাল (মসুর)');
  });
  it('exports readable Bengali CSV with BOM', () => {
    const { file } = exportCsv(db, ctx, 'products');
    const raw = fs.readFileSync(file);
    expect(raw[0]).toBe(0xef);
    expect(raw.toString('utf8')).toContain('গেট পণ্য');
  });
});

describe('login throttle (§20)', () => {
  it('locks a username after repeated failures without affecting others', () => {
    createUser(db, ctx, { name: 'থ্রটল', username: 'throttle1', password: 'Passw0rd!', role: 'cashier' });
    createUser(db, ctx, { name: 'অন্য', username: 'otheruser1', password: 'Passw0rd!', role: 'cashier' });
    for (let i = 0; i < 4; i++) {
      expect(codeOf(() => login(db, 'throttle1', 'wrong'))).toBe('INVALID_CREDENTIALS');
    }
    expect(codeOf(() => login(db, 'throttle1', 'wrong'))).toBe('AUTH_LOCKED');
    expect(codeOf(() => login(db, 'throttle1', 'Passw0rd!'))).toBe('AUTH_LOCKED');
    const ok = login(db, 'otheruser1', 'Passw0rd!');
    expect(ok.user.username).toBe('otheruser1');
  });
});

describe('backup/restore round-trip (§16)', () => {
  it('restores exact prior state with safety backup and stays consistent', () => {
    const udata = path.join(tmpRoot, 'userdata2');
    setUserDataRoot(udata);
    const gdb = openDatabase();
    const s = runSetup(gdb, {
      business: { name: 'রিস্টোর টেস্ট' },
      openingBalances: { CASH: 100000 },
      admin: { name: 'মালিক', username: 'restoreowner', password: 'Passw0rd!' },
    });
    const gctx: Ctx = { businessId: s.business!.id, userId: s.user.id, permissions: [...PERMISSIONS] };
    const aId = createProduct(gdb, gctx, { name: 'আগের পণ্য', purchase_price: 10, selling_price: 20 });
    const bk = createBackup(gdb, gctx, 'gate');
    expect(fs.existsSync(bk.file)).toBe(true);
    createProduct(gdb, gctx, { name: 'পরের পণ্য', purchase_price: 10, selling_price: 20 });
    restoreBackup(gdb, gctx, bk.file);
    const reopened = openDatabase();
    const names = (reopened.prepare('SELECT name FROM products WHERE business_id = ?').all(gctx.businessId) as { name: string }[]).map((r) => r.name);
    expect(names).toContain('আগের পণ্য');
    expect(names).not.toContain('পরের পণ্য');
    void aId;
    const safetyFiles = fs.readdirSync(path.join(udata, 'backups')).filter((f) => f.startsWith('merqo-pre-restore-'));
    expect(safetyFiles.length).toBeGreaterThan(0);
    expect(integrityCheck(reopened).ok).toBe(true);
    const ie = incomeExpense(reopened, gctx, { from: '2000-01-01', to: '2100-01-01' }) as Record<string, number>;
    expect(ie.revenue).toBe(0);
  });
});

describe('performance floor (§19)', () => {
  it('searches 10k products and pages lists within budget', () => {
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO products (business_id, name, purchase_price, selling_price, stock_milli, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const txn = (db as unknown as { transaction: (fn: () => void) => () => void }).transaction(() => {
      for (let i = 0; i < 10000; i++) {
        ins.run(businessId, `পারফ পণ্য ${i}`, 100, 150, 1000, now, now);
      }
    });
    txn();
    const t0 = Date.now();
    const hits = searchProducts(db, ctx, 'পারফ পণ্য 9999');
    const searchMs = Date.now() - t0;
    expect(hits.some((h) => h.name === 'পারফ পণ্য 9999')).toBe(true);
    const t1 = Date.now();
    const page = listProducts(db, ctx, { q: 'পারফ', page: 1, pageSize: 50 });
    const listMs = Date.now() - t1;
    expect(page.rows.length).toBe(50);
    // generous CI budgets (informational if exceeded on very slow disks)
    expect(searchMs).toBeLessThan(5000);
    expect(listMs).toBeLessThan(5000);
  });
});
