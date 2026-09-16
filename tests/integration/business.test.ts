import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIsolatedDatabase, integrityCheck, type Db } from '../../src/main/db';
import { AppError, Ctx, accountBalance, customerDue, supplierPayable } from '../../src/main/services/_helpers';
import { runSetup, permissionsFor } from '../../src/main/services/authService';
import { createProduct, findByBarcode } from '../../src/main/services/productService';
import { completeSale, holdSale, cancelHeld, voidSale, createSaleReturn } from '../../src/main/services/salesService';
import { completePurchase, createPurchaseReturn } from '../../src/main/services/purchaseService';
import { createCustomer, createSupplier, receiveCustomerPayment, paySupplier } from '../../src/main/services/partyService';
import { transfer, createExpense, listAccounts } from '../../src/main/services/accountService';
import { createMfsTransaction } from '../../src/main/services/mfsService';
import { dashboard, incomeExpense } from '../../src/main/services/reportService';
import { PERMISSIONS } from '../../src/shared/constants';

let db: Db;
let ctx: Ctx;
let tmpFile: string;
const ALL = [...PERMISSIONS];

beforeAll(() => {
  tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'merqo-test-')), 'test.db');
  db = openIsolatedDatabase(tmpFile);
  const session = runSetup(db, {
    business: { name: 'টেস্ট স্টোর', phone: '01700000000' },
    openingBalances: { CASH: 100000, BANK: 500000 },
    admin: { name: 'মালিক', username: 'owner', password: 'secret1' },
  });
  ctx = { businessId: session.business!.id, userId: session.user.id, permissions: ALL };
  expect(permissionsFor(db, ctx.businessId, 'owner')).toContain('sale.create');
});

afterAll(() => {
  db.close();
  try { fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true }); } catch { /* noop */ }
});

function acct(code: string): number {
  const row = db.prepare('SELECT id FROM financial_accounts WHERE business_id = ? AND code = ?').get(ctx.businessId, code) as { id: number };
  return row.id;
}

describe('full retail scenario', () => {
  let productId = 0;
  let supplierId = 0;
  let customerId = 0;
  let saleId = 0;
  let purchaseRef = '';

  it('creates master data and product with opening stock', () => {
    supplierId = createSupplier(db, ctx, { name: 'পাইকারি ভাই', opening_payable: 20000 });
    expect(supplierPayable(db, ctx.businessId, supplierId)).toBe(20000);
    customerId = createCustomer(db, ctx, { name: 'করিম', opening_due: 5000 });
    expect(customerDue(db, ctx.businessId, customerId)).toBe(5000);
    const unit = db.prepare("SELECT id FROM units WHERE business_id = ? AND name = 'পিস'").get(ctx.businessId) as { id: number };
    productId = createProduct(db, ctx, {
      name: 'চিনি ১ কেজি', sku: 'SGR-001', barcode: '123456789', unit_id: unit.id,
      purchase_price: 12000, selling_price: 14000, min_stock_milli: 5000, opening_stock_milli: 100000,
    });
    const p = db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number };
    expect(p.stock_milli).toBe(100000);
    expect(findByBarcode(db, ctx, '123456789').id).toBe(productId);
  });

  it('blocks duplicate barcode with Bengali-safe code', () => {
    expect(() => createProduct(db, ctx, { name: 'ডুপ্লিকেট', barcode: '123456789', purchase_price: 1, selling_price: 2 })).toThrowError(expect.objectContaining({ code: 'BARCODE_DUPLICATE' }));
  });

  it('completes a purchase: stock + payable + payment + FIFO layer', () => {
    const cashBefore = accountBalance(db, ctx.businessId, acct('CASH'));
    const r = completePurchase(db, ctx, {
      supplier_id: supplierId,
      items: [{ product_id: productId, qty_milli: 50000, unit_cost: 12500 }],
      payments: [{ account_id: acct('CASH'), method: 'cash', amount: 200000 }],
    });
    purchaseRef = r.reference;
    expect(r.total).toBe(625000); // 50 * 125.00
    expect(r.paid).toBe(200000);
    expect(r.due).toBe(425000);
    const p = db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number };
    expect(p.stock_milli).toBe(150000);
    expect(supplierPayable(db, ctx.businessId, supplierId)).toBe(20000 + 625000 - 200000);
    expect(accountBalance(db, ctx.businessId, acct('CASH'))).toBe(cashBefore - 200000);
    const layers = db.prepare('SELECT COALESCE(SUM(qty_milli_remaining),0) AS s FROM cost_layers WHERE product_id = ?').get(productId) as { s: number };
    expect(layers.s).toBe(150000);
  });

  it('completes a credit sale: stock - FIFO COGS + due + payment', () => {
    const cashBefore = accountBalance(db, ctx.businessId, acct('CASH'));
    const r = completeSale(db, ctx, {
      items: [{ product_id: productId, qty_milli: 20000, unit_price: 14000 }],
      customer_id: customerId,
      payments: [{ account_id: acct('CASH'), method: 'cash', amount: 200000 }],
    });
    saleId = r.id;
    expect(r.total).toBe(280000);
    expect(r.paid).toBe(200000);
    expect(r.due).toBe(80000);
    const p = db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number };
    expect(p.stock_milli).toBe(130000);
    // FIFO: first 20 units consumed from opening layer @120.00
    const item = db.prepare('SELECT unit_cost FROM sale_items WHERE sale_id = ?').get(saleId) as { unit_cost: number };
    expect(item.unit_cost).toBe(12000);
    expect(customerDue(db, ctx.businessId, customerId)).toBe(5000 + 280000 - 200000);
    expect(accountBalance(db, ctx.businessId, acct('CASH'))).toBe(cashBefore + 200000);
  });

  it('blocks walk-in due sales and overpayment', () => {
    expect(() => completeSale(db, ctx, {
      items: [{ product_id: productId, qty_milli: 1000, unit_price: 14000 }],
      payments: [],
    })).toThrowError(expect.objectContaining({ code: 'CUSTOMER_REQUIRED_FOR_DUE' }));
    expect(() => completeSale(db, ctx, {
      items: [{ product_id: productId, qty_milli: 1000, unit_price: 14000 }],
      customer_id: customerId,
      payments: [{ account_id: acct('CASH'), method: 'cash', amount: 9999999 }],
    })).toThrowError(expect.objectContaining({ code: 'OVERPAYMENT_BLOCKED' }));
  });

  it('blocks negative stock by default', () => {
    expect(() => completeSale(db, ctx, {
      items: [{ product_id: productId, qty_milli: 999999999, unit_price: 14000 }],
      customer_id: customerId,
      payments: [],
    })).toThrowError(expect.objectContaining({ code: 'NEGATIVE_STOCK_BLOCKED' }));
  });

  it('receives customer payment and pays supplier', () => {
    const dueBefore = customerDue(db, ctx.businessId, customerId);
    const r = receiveCustomerPayment(db, ctx, { customer_id: customerId, account_id: acct('CASH'), method: 'cash', amount: 25000 });
    expect(r.remaining_due).toBe(dueBefore - 25000);
    expect(customerDue(db, ctx.businessId, customerId)).toBe(dueBefore - 25000);
    const payBefore = supplierPayable(db, ctx.businessId, supplierId);
    const s = paySupplier(db, ctx, { supplier_id: supplierId, account_id: acct('CASH'), method: 'cash', amount: 100000 });
    expect(s.remaining_payable).toBe(payBefore - 100000);
  });

  it('records expense and transfer', () => {
    const cashBefore = accountBalance(db, ctx.businessId, acct('CASH'));
    const cat = db.prepare('SELECT id FROM expense_categories WHERE business_id = ? LIMIT 1').get(ctx.businessId) as { id: number };
    createExpense(db, ctx, { category_id: cat.id, amount: 5000, account_id: acct('CASH'), description: 'ভাড়া' });
    expect(accountBalance(db, ctx.businessId, acct('CASH'))).toBe(cashBefore - 5000);
    const bankBefore = accountBalance(db, ctx.businessId, acct('BANK'));
    transfer(db, ctx, { from_account_id: acct('CASH'), to_account_id: acct('BANK'), amount: 10000 });
    expect(accountBalance(db, ctx.businessId, acct('CASH'))).toBe(cashBefore - 5000 - 10000);
    expect(accountBalance(db, ctx.businessId, acct('BANK'))).toBe(bankBefore + 10000);
  });

  it('records MFS agent transaction with mirrored movements', () => {
    const cashBefore = accountBalance(db, ctx.businessId, acct('CASH'));
    const bkashBefore = accountBalance(db, ctx.businessId, acct('BKASH'));
    createMfsTransaction(db, ctx, { provider: 'bkash', txn_type: 'CASH_IN', customer_mobile: '01800000000', amount: 100000, charge: 2000, commission: 500, cash_account_id: acct('CASH') });
    expect(accountBalance(db, ctx.businessId, acct('CASH'))).toBe(cashBefore + 102000);
    expect(accountBalance(db, ctx.businessId, acct('BKASH'))).toBe(bkashBefore - 100000);
  });

  it('processes sale return: stock back + ledger + refund', () => {
    const stockBefore = (db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number }).stock_milli;
    const dueBefore = customerDue(db, ctx.businessId, customerId);
    const si = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId) as { id: number };
    const r = createSaleReturn(db, ctx, { sale_id: saleId, items: [{ sale_item_id: si.id, qty_milli: 2000 }], account_id: acct('CASH'), reason: 'ত্রুটি' });
    expect(r.total_refund).toBe(28000); // 2 * 140.00
    const stockAfter = (db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number }).stock_milli;
    expect(stockAfter).toBe(stockBefore + 2000);
    expect(customerDue(db, ctx.businessId, customerId)).toBe(dueBefore - 28000);
    // Double return beyond sold qty is blocked
    expect(() => createSaleReturn(db, ctx, { sale_id: saleId, items: [{ sale_item_id: si.id, qty_milli: 99999999 }], account_id: acct('CASH') }))
      .toThrowError(expect.objectContaining({ code: 'RETURN_EXCEEDS_SALE' }));
  });

  it('processes purchase return', () => {
    const pur = db.prepare('SELECT id FROM purchases WHERE reference = ?').get(purchaseRef) as { id: number };
    const pi = db.prepare('SELECT id FROM purchase_items WHERE purchase_id = ?').get(pur.id) as { id: number };
    const payBefore = supplierPayable(db, ctx.businessId, supplierId);
    const r = createPurchaseReturn(db, ctx, { purchase_id: pur.id, items: [{ purchase_item_id: pi.id, qty_milli: 5000 }] });
    expect(r.total_credit).toBe(62500); // 5 * 125.00
    expect(supplierPayable(db, ctx.businessId, supplierId)).toBe(payBefore - 62500);
  });

  it('holds and cancels a sale without touching stock', () => {
    const stockBefore = (db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number }).stock_milli;
    const h = holdSale(db, ctx, { items: [{ product_id: productId, qty_milli: 1000, unit_price: 14000 }], held_name: 'টেবিল-১' });
    const stockAfter = (db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number }).stock_milli;
    expect(stockAfter).toBe(stockBefore);
    cancelHeld(db, ctx, h.id);
  });

  it('voids a sale with full reversal', () => {
    const s = completeSale(db, ctx, {
      items: [{ product_id: productId, qty_milli: 1000, unit_price: 14000 }],
      customer_id: customerId,
      payments: [{ account_id: acct('CASH'), method: 'cash', amount: 14000 }],
    });
    const stockBefore = (db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number }).stock_milli;
    const dueBefore = customerDue(db, ctx.businessId, customerId);
    const cashBefore = accountBalance(db, ctx.businessId, acct('CASH'));
    voidSale(db, ctx, s.id, 'ভুল এন্ট্রি');
    const stockAfter = (db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number }).stock_milli;
    expect(stockAfter).toBe(stockBefore + 1000);
    expect(customerDue(db, ctx.businessId, customerId)).toBe(dueBefore); // debit total + credit paid were both reversed
    expect(accountBalance(db, ctx.businessId, acct('CASH'))).toBe(cashBefore - 14000);
    expect(() => voidSale(db, ctx, s.id, 'again')).toThrowError(expect.objectContaining({ code: 'SALE_ALREADY_VOID' }));
  });

  it('denies actions without permission', () => {
    const limited: Ctx = { ...ctx, permissions: [] };
    expect(() => completeSale(db, limited, { items: [], payments: [] })).toThrowError(expect.objectContaining({ code: 'NO_PERMISSION' }));
  });

  it('keeps dashboard and reports reconciled', () => {
    const from = '2000-01-01T00:00:00.000Z';
    const to = '2100-01-01T00:00:00.000Z';
    const d = dashboard(db, ctx, from, to, from, to) as { kpi: Record<string, number> };
    const inc = incomeExpense(db, ctx, { from, to }) as Record<string, number>;
    // KPI sales (all-time here) must equal income report revenue
    expect(d.kpi.sales).toBe(inc.revenue);
    expect(d.kpi.expenses).toBe(inc.expenses);
    // Profit identity: gross = revenue - cogs ; net = gross - expenses + commission
    expect(inc.gross).toBe(Math.round(inc.revenue - inc.cogs));
    expect(inc.net).toBe(inc.gross - inc.expenses + inc.mfsCommission);
    // Stock flow identity
    const p = db.prepare('SELECT stock_milli FROM products WHERE id = ?').get(productId) as { stock_milli: number };
    const moved = db.prepare('SELECT COALESCE(SUM(qty_milli),0) AS s FROM inventory_movements WHERE product_id = ?').get(productId) as { s: number };
    expect(p.stock_milli).toBe(moved.s);
    // Ledger running-balance consistency (last row == recomputed sum)
    const lastC = db.prepare('SELECT balance FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 1').get(customerId) as { balance: number };
    expect(lastC.balance).toBe(customerDue(db, ctx.businessId, customerId));
    const lastS = db.prepare('SELECT balance FROM supplier_ledger WHERE supplier_id = ? ORDER BY id DESC LIMIT 1').get(supplierId) as { balance: number };
    expect(lastS.balance).toBe(supplierPayable(db, ctx.businessId, supplierId));
    // Account list matches recomputation
    const accs = listAccounts(db, ctx);
    for (const a of accs) {
      expect(a.current_balance).toBe(accountBalance(db, ctx.businessId, a.id));
    }
  });

  it('passes SQLite integrity check', () => {
    expect(integrityCheck(db).ok).toBe(true);
  });
});

describe('error codes', () => {
  it('AppError carries machine-readable codes', () => {
    const e = new AppError('BARCODE_DUPLICATE');
    expect(e.code).toBe('BARCODE_DUPLICATE');
  });
});
