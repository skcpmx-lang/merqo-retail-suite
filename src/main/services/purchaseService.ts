import type { Db } from '../db';
import {
  AppError, Ctx, audit, requirePerm, paginate, nextReference,
  moveStock, pushCostLayer, removeNewestCostLayers, addMoneyMovement, addSupplierLedger,
} from './_helpers';
import { nowIso } from '../../shared/dates';
import { percentOf, mulPaisa } from '../../shared/money';
import { sanitizeText } from '../../shared/validators';
import type { Paged, Purchase } from '../../shared/types';

export interface PurchaseItemInput {
  product_id: number;
  qty_milli: number;
  unit_cost: number;
  discount?: number;
  new_selling_price?: number;
  batch_no?: string | null;
  expiry_date?: string | null;
}

export interface PurchasePaymentInput {
  account_id: number;
  method: string;
  amount: number;
  reference?: string;
}

export interface CompletePurchaseInput {
  supplier_id?: number | null;
  supplier_invoice?: string | null;
  items: PurchaseItemInput[];
  invoice_discount?: number;
  payments: PurchasePaymentInput[];
  notes?: string | null;
  purchased_at?: string;
}

export function completePurchase(db: Db, ctx: Ctx, input: CompletePurchaseInput): { id: number; reference: string; total: number; paid: number; due: number } {
  requirePerm(ctx, 'purchase.create');
  if (!input.items.length) throw new AppError('EMPTY_CART');
  const cfg = db.prepare('SELECT tax_mode, tax_default_bp FROM businesses WHERE id = ?').get(ctx.businessId) as { tax_mode: string; tax_default_bp: number };
  let subtotal = 0;
  let itemTax = 0;
  const lines: { product_id: number; qty_milli: number; unit_cost: number; discount: number; tax: number; line_total: number; new_selling_price?: number; batch_no?: string | null; expiry_date?: string | null }[] = [];
  for (const it of input.items) {
    if (!Number.isInteger(it.qty_milli) || it.qty_milli <= 0) throw new AppError('INVALID_QTY');
    if (!Number.isInteger(it.unit_cost) || it.unit_cost < 0) throw new AppError('INVALID_PRICE');
    const p = db.prepare('SELECT id, tax_bp FROM products WHERE id = ? AND business_id = ?').get(it.product_id, ctx.businessId) as
      | { id: number; tax_bp: number } | undefined;
    if (!p) throw new AppError('PRODUCT_NOT_FOUND');
    const discount = it.discount ?? 0;
    if (!Number.isInteger(discount) || discount < 0) throw new AppError('INVALID_DISCOUNT');
    const gross = mulPaisa(it.unit_cost, it.qty_milli);
    if (discount > gross) throw new AppError('INVALID_DISCOUNT');
    let tax = 0;
    if (cfg.tax_mode === 'item' && p.tax_bp > 0) tax = percentOf(gross - discount, p.tax_bp);
    const line_total = gross - discount + tax;
    subtotal += gross - discount;
    itemTax += tax;
    lines.push({ ...it, discount, tax, line_total });
  }
  const invoiceDiscount = input.invoice_discount ?? 0;
  if (!Number.isInteger(invoiceDiscount) || invoiceDiscount < 0 || invoiceDiscount > subtotal) throw new AppError('INVALID_DISCOUNT');
  let invoiceTax = 0;
  if (cfg.tax_mode === 'invoice' && cfg.tax_default_bp > 0) invoiceTax = percentOf(subtotal - invoiceDiscount, cfg.tax_default_bp);
  const tax = itemTax + invoiceTax;
  const total = subtotal - invoiceDiscount + tax;
  let paid = 0;
  for (const pay of input.payments ?? []) {
    if (!Number.isInteger(pay.amount) || pay.amount < 0) throw new AppError('INVALID_AMOUNT');
    const acct = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ? AND active = 1').get(pay.account_id, ctx.businessId);
    if (!acct) throw new AppError('ACCOUNT_NOT_FOUND');
    paid += pay.amount;
  }
  if (paid > total) throw new AppError('OVERPAYMENT_BLOCKED');
  const due = total - paid;
  const supplierId = input.supplier_id ?? null;
  if (supplierId) {
    const s = db.prepare('SELECT id FROM suppliers WHERE id = ? AND business_id = ?').get(supplierId, ctx.businessId);
    if (!s) throw new AppError('SUPPLIER_NOT_FOUND');
  }
  if (due > 0 && !supplierId) throw new AppError('SUPPLIER_REQUIRED_FOR_DUE');
  const at = input.purchased_at || nowIso();

  const txn = db.transaction(() => {
    const reference = nextReference(db, ctx.businessId, 'purchases', 'PO');
    const r = db.prepare(
      `INSERT INTO purchases (business_id, reference, supplier_id, supplier_invoice, subtotal, discount, tax, total, paid, due, status, notes, purchased_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)`,
    ).run(ctx.businessId, reference, supplierId, sanitizeText(input.supplier_invoice, 100), subtotal, invoiceDiscount, tax, total, paid, due,
      sanitizeText(input.notes, 1000), at, ctx.userId, nowIso());
    const pid = Number(r.lastInsertRowid);
    const insItem = db.prepare('INSERT INTO purchase_items (purchase_id, product_id, qty_milli, unit_cost, discount, tax, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insPay = db.prepare('INSERT INTO purchase_payments (purchase_id, account_id, method, amount, reference, paid_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const ln of lines) {
      insItem.run(pid, ln.product_id, ln.qty_milli, ln.unit_cost, ln.discount, ln.tax, ln.line_total);
      moveStock(db, ctx, ln.product_id, ln.qty_milli, 'PURCHASE', 'PURCHASE', pid, `ক্রয় ${reference}`, at);
      pushCostLayer(db, ctx.businessId, ln.product_id, pid, ln.qty_milli, ln.unit_cost);
      // Update product cost/selling price
      db.prepare('UPDATE products SET purchase_price = ?, selling_price = COALESCE(?, selling_price), updated_at = ? WHERE id = ?').run(
        ln.unit_cost, ln.new_selling_price ?? null, nowIso(), ln.product_id,
      );
      if (ln.batch_no || ln.expiry_date) {
        db.prepare('INSERT INTO product_batches (product_id, batch_no, expiry_date, qty_milli, unit_cost, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          ln.product_id, ln.batch_no?.trim() || null, ln.expiry_date || null, ln.qty_milli, ln.unit_cost, nowIso(),
        );
      }
    }
    for (const pay of input.payments ?? []) {
      if (pay.amount <= 0) continue;
      insPay.run(pid, pay.account_id, pay.method, pay.amount, pay.reference?.trim() || null, at, ctx.userId);
      addMoneyMovement(db, ctx, pay.account_id, 'OUT', pay.amount, 'PURCHASE', pid, `ক্রয় ${reference}`, at);
    }
    if (supplierId) {
      // Supplier ledger: credit increases payable, debit = paid portion
      addSupplierLedger(db, ctx, supplierId, at, 'PURCHASE', pid, `ক্রয় ${reference}`, paid, total, null);
    }
    audit(db, ctx, 'purchase.complete', 'purchase', pid, null, { reference, total, paid, due });
    return { id: pid, reference, total, paid, due };
  });
  return txn();
}

export function listPurchases(db: Db, ctx: Ctx, opts: { q?: string; from?: string; to?: string; supplier_id?: number; page?: number; pageSize?: number }): Paged<Purchase> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['p.business_id = ?', "p.status != 'VOID'"];
  const params: unknown[] = [ctx.businessId];
  if (opts.from) { where.push('p.purchased_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('p.purchased_at <= ?'); params.push(opts.to); }
  if (opts.supplier_id) { where.push('p.supplier_id = ?'); params.push(opts.supplier_id); }
  if (opts.q?.trim()) {
    where.push('(p.reference LIKE ? OR p.supplier_invoice LIKE ? OR s.name LIKE ?)');
    const q = `%${opts.q.trim()}%`;
    params.push(q, q, q);
  }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Purchase[];
  return { rows, total, page, pageSize };
}

export function getPurchaseDetail(db: Db, ctx: Ctx, id: number): Record<string, unknown> {
  const purchase = db.prepare(
    `SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, u.name AS employee_name FROM purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ? AND p.business_id = ?`,
  ).get(id, ctx.businessId) as Record<string, unknown> | undefined;
  if (!purchase) throw new AppError('PURCHASE_NOT_FOUND');
  const items = db.prepare(
    `SELECT pi.*, pr.name AS product_name, u.name AS unit_name FROM purchase_items pi
     JOIN products pr ON pr.id = pi.product_id LEFT JOIN units u ON u.id = pr.unit_id WHERE pi.purchase_id = ?`,
  ).all(id);
  const payments = db.prepare(
    `SELECT pp.*, a.name AS account_name FROM purchase_payments pp JOIN financial_accounts a ON a.id = pp.account_id WHERE pp.purchase_id = ?`,
  ).all(id);
  return { purchase, items, payments };
}

export function voidPurchase(db: Db, ctx: Ctx, id: number, reason: string): void {
  requirePerm(ctx, 'purchase.return');
  if (!reason?.trim()) throw new AppError('REQUIRED');
  const now = nowIso();
  const txn = db.transaction(() => {
    const pur = db.prepare("SELECT * FROM purchases WHERE id = ? AND business_id = ? AND status = 'COMPLETED'").get(id, ctx.businessId) as
      | (Purchase & { supplier_id: number | null }) | undefined;
    if (!pur) throw new AppError('PURCHASE_NOT_FOUND');
    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(id) as { product_id: number; qty_milli: number; returned_milli: number }[];
    for (const it of items) {
      const net = it.qty_milli - (it.returned_milli ?? 0);
      if (net > 0) {
        moveStock(db, ctx, it.product_id, -net, 'PURCHASE', 'PURCHASE_VOID', id, `বাতিল ${pur.reference}`, now);
        removeNewestCostLayers(db, ctx.businessId, it.product_id, net);
      }
    }
    const pays = db.prepare('SELECT * FROM purchase_payments WHERE purchase_id = ?').all(id) as { account_id: number; amount: number }[];
    for (const p of pays) addMoneyMovement(db, ctx, p.account_id, 'IN', p.amount, 'PURCHASE_VOID', id, `বাতিল ${pur.reference}`, now);
    if (pur.supplier_id) {
      addSupplierLedger(db, ctx, pur.supplier_id, now, 'PURCHASE_VOID', id, `বাতিল ${pur.reference}`, pur.total, 0, null);
      if (pur.paid > 0) addSupplierLedger(db, ctx, pur.supplier_id, now, 'PURCHASE_VOID', id, `বাতিল পেমেন্ট সমন্বয় ${pur.reference}`, 0, pur.paid, null);
    }
    db.prepare('UPDATE purchases SET status = ?, due = 0, voided_at = ?, void_reason = ?, voided_by = ? WHERE id = ?').run('VOID', now, reason.trim(), ctx.userId, id);
    audit(db, ctx, 'purchase.void', 'purchase', id, { reference: pur.reference, total: pur.total }, null, reason.trim());
  });
  txn();
}

export function createPurchaseReturn(
  db: Db, ctx: Ctx,
  input: { purchase_id: number; items: { purchase_item_id: number; qty_milli: number }[]; account_id?: number | null; reason?: string; returned_at?: string },
): { id: number; reference: string; total_credit: number } {
  requirePerm(ctx, 'purchase.return');
  if (!input.items.length) throw new AppError('INVALID_QTY');
  const pur = db.prepare("SELECT * FROM purchases WHERE id = ? AND business_id = ? AND status = 'COMPLETED'").get(input.purchase_id, ctx.businessId) as
    | (Purchase & { supplier_id: number | null }) | undefined;
  if (!pur) throw new AppError('PURCHASE_NOT_FOUND');
  if (input.account_id) {
    const acct = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ? AND active = 1').get(input.account_id, ctx.businessId);
    if (!acct) throw new AppError('ACCOUNT_NOT_FOUND');
  }
  const at = input.returned_at || nowIso();
  const txn = db.transaction(() => {
    const reference = nextReference(db, ctx.businessId, 'purchase_returns', 'PR');
    let totalCredit = 0;
    const lines: { purchase_item_id: number; product_id: number; qty_milli: number; credit: number }[] = [];
    for (const it of input.items) {
      if (!Number.isInteger(it.qty_milli) || it.qty_milli <= 0) throw new AppError('INVALID_QTY');
      const pi = db.prepare('SELECT * FROM purchase_items WHERE id = ? AND purchase_id = ?').get(it.purchase_item_id, input.purchase_id) as
        | { id: number; product_id: number; qty_milli: number; line_total: number; returned_milli: number } | undefined;
      if (!pi) throw new AppError('PURCHASE_NOT_FOUND');
      if (it.qty_milli > pi.qty_milli - (pi.returned_milli ?? 0)) throw new AppError('RETURN_EXCEEDS_PURCHASE');
      const credit = Math.round((pi.line_total * it.qty_milli) / pi.qty_milli);
      totalCredit += credit;
      lines.push({ purchase_item_id: pi.id, product_id: pi.product_id, qty_milli: it.qty_milli, credit });
    }
    if (totalCredit <= 0) throw new AppError('INVALID_AMOUNT');
    const r = db.prepare(
      'INSERT INTO purchase_returns (business_id, reference, purchase_id, supplier_id, total_credit, account_id, reason, returned_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(ctx.businessId, reference, input.purchase_id, pur.supplier_id, totalCredit, input.account_id ?? null, sanitizeText(input.reason, 500), at, ctx.userId, nowIso());
    const retId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO purchase_return_items (purchase_return_id, purchase_item_id, product_id, qty_milli, credit) VALUES (?, ?, ?, ?, ?)');
    const upd = db.prepare('UPDATE purchase_items SET returned_milli = returned_milli + ? WHERE id = ?');
    for (const ln of lines) {
      ins.run(retId, ln.purchase_item_id, ln.product_id, ln.qty_milli, ln.credit);
      upd.run(ln.qty_milli, ln.purchase_item_id);
      moveStock(db, ctx, ln.product_id, -ln.qty_milli, 'PURCHASE_RETURN', 'PURCHASE_RETURN', retId, `ফেরত ${reference}`, at);
      removeNewestCostLayers(db, ctx.businessId, ln.product_id, ln.qty_milli);
    }
    if (input.account_id) {
      addMoneyMovement(db, ctx, input.account_id, 'IN', totalCredit, 'PURCHASE_RETURN', retId, `ক্রয় ফেরত ${reference}`, at);
    }
    if (pur.supplier_id) {
      addSupplierLedger(db, ctx, pur.supplier_id, at, 'PURCHASE_RETURN', retId, `ক্রয় ফেরত ${reference}`, totalCredit, 0, null);
    }
    db.prepare('UPDATE purchases SET due = MAX(0, due - ?) WHERE id = ?').run(totalCredit, input.purchase_id);
    audit(db, ctx, 'purchase.return', 'purchase_return', retId, null, { reference, total_credit: totalCredit }, sanitizeText(input.reason, 500));
    return { id: retId, reference, total_credit: totalCredit };
  });
  return txn();
}

export function listPurchaseReturns(db: Db, ctx: Ctx, opts: { from?: string; to?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['r.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.from) { where.push('r.returned_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('r.returned_at <= ?'); params.push(opts.to); }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM purchase_returns r WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT r.*, p.reference AS purchase_ref, s.name AS supplier_name FROM purchase_returns r
     JOIN purchases p ON p.id = r.purchase_id LEFT JOIN suppliers s ON s.id = r.supplier_id
     WHERE ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}
