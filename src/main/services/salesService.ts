import type { Db } from '../db';
import {
  AppError, Ctx, audit, requirePerm, paginate, nextInvoiceNo, nextReference,
  moveStock, consumeCostLayers, restoreCostLayer, addMoneyMovement, addCustomerLedger,
} from './_helpers';
import { nowIso } from '../../shared/dates';
import { percentOf, mulPaisa } from '../../shared/money';
import { sanitizeText } from '../../shared/validators';
import { refreshStockNotifications } from './productService';
import type { Paged, Sale } from '../../shared/types';

export interface CartItemInput {
  product_id: number;
  qty_milli: number;
  unit_price: number;
  discount?: number;
}

export interface PaymentInput {
  account_id: number;
  method: string;
  amount: number;
  reference?: string;
}

export interface CompleteSaleInput {
  items: CartItemInput[];
  customer_id?: number | null;
  invoice_discount?: number;
  payments: PaymentInput[];
  notes?: string | null;
  sold_at?: string;
}

interface ComputedLine extends CartItemInput {
  name: string;
  tax: number;
  line_total: number;
  unit_cost: number;
}

function getBusinessCfg(db: Db, businessId: number): { tax_mode: string; tax_default_bp: number; overpayment_policy: string } {
  return db.prepare('SELECT tax_mode, tax_default_bp, overpayment_policy FROM businesses WHERE id = ?').get(businessId) as {
    tax_mode: string; tax_default_bp: number; overpayment_policy: string;
  };
}

function computeCart(db: Db, ctx: Ctx, items: CartItemInput[], canOverridePrice: boolean, canDiscount: boolean): { lines: ComputedLine[]; subtotal: number; tax: number } {
  if (!items.length) throw new AppError('EMPTY_CART');
  const cfg = getBusinessCfg(db, ctx.businessId);
  const lines: ComputedLine[] = [];
  let subtotal = 0;
  let itemTax = 0;
  for (const it of items) {
    if (!Number.isInteger(it.qty_milli) || it.qty_milli <= 0) throw new AppError('INVALID_QTY');
    if (!Number.isInteger(it.unit_price) || it.unit_price < 0) throw new AppError('INVALID_PRICE');
    const p = db.prepare('SELECT id, name, status, min_selling_price, tax_bp, purchase_price, stock_milli FROM products WHERE id = ? AND business_id = ?').get(
      it.product_id, ctx.businessId,
    ) as { id: number; name: string; status: string; min_selling_price: number; tax_bp: number; purchase_price: number; stock_milli: number } | undefined;
    if (!p) throw new AppError('PRODUCT_NOT_FOUND');
    if (p.status !== 'active') throw new AppError('PRODUCT_INACTIVE');
    if (p.min_selling_price > 0 && it.unit_price < p.min_selling_price && !canOverridePrice) throw new AppError('NO_PERMISSION');
    const discount = it.discount ?? 0;
    if (!Number.isInteger(discount) || discount < 0) throw new AppError('INVALID_DISCOUNT');
    if (discount > 0 && !canDiscount) throw new AppError('NO_PERMISSION');
    const gross = mulPaisa(it.unit_price, it.qty_milli);
    if (discount > gross) throw new AppError('INVALID_DISCOUNT');
    let tax = 0;
    if (cfg.tax_mode === 'item' && p.tax_bp > 0) tax = percentOf(gross - discount, p.tax_bp);
    const line_total = gross - discount + tax;
    subtotal += gross - discount;
    itemTax += tax;
    lines.push({ ...it, discount, name: p.name, tax, line_total, unit_cost: 0 });
  }
  return { lines, subtotal, tax: itemTax };
}

export function completeSale(db: Db, ctx: Ctx, input: CompleteSaleInput, heldId?: number): { id: number; invoice_no: string; total: number; paid: number; due: number; change_amount: number } {
  requirePerm(ctx, 'sale.create');
  const canOverride = ctx.permissions.includes('sale.price_override');
  const canDiscount = ctx.permissions.includes('sale.discount');
  const cfg = getBusinessCfg(db, ctx.businessId);
  const { lines, subtotal, tax: itemTax } = computeCart(db, ctx, input.items, canOverride, canDiscount);
  const invoiceDiscount = input.invoice_discount ?? 0;
  if (!Number.isInteger(invoiceDiscount) || invoiceDiscount < 0 || invoiceDiscount > subtotal) throw new AppError('INVALID_DISCOUNT');
  if (invoiceDiscount > 0 && !canDiscount) throw new AppError('NO_PERMISSION');
  let invoiceTax = 0;
  if (cfg.tax_mode === 'invoice' && cfg.tax_default_bp > 0) invoiceTax = percentOf(subtotal - invoiceDiscount, cfg.tax_default_bp);
  const tax = itemTax + invoiceTax;
  const total = subtotal - invoiceDiscount + tax;
  if (total < 0) throw new AppError('INVALID_TOTAL');

  const payments = input.payments ?? [];
  let paid = 0;
  for (const pay of payments) {
    if (!Number.isInteger(pay.amount) || pay.amount < 0) throw new AppError('INVALID_AMOUNT');
    const acct = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ? AND active = 1').get(pay.account_id, ctx.businessId);
    if (!acct) throw new AppError('ACCOUNT_NOT_FOUND');
    paid += pay.amount;
  }
  const customerId = input.customer_id ?? null;
  if (customerId) {
    const c = db.prepare('SELECT id FROM customers WHERE id = ? AND business_id = ?').get(customerId, ctx.businessId);
    if (!c) throw new AppError('CUSTOMER_NOT_FOUND');
  }
  let due = total - paid;
  let change = 0;
  let advance = 0;
  if (due < 0) {
    if (!customerId) {
      // Walk-in overpayment = change back
      change = -due;
      due = 0;
      paid = total;
    } else if (cfg.overpayment_policy === 'block') {
      throw new AppError('OVERPAYMENT_BLOCKED');
    } else {
      advance = -due;
      due = 0;
      paid = total;
    }
  }
  if (due > 0 && !customerId) throw new AppError('CUSTOMER_REQUIRED_FOR_DUE');

  const soldAt = input.sold_at || nowIso();
  const paymentStatus = due === 0 ? 'PAID' : paid === 0 ? 'DUE' : 'PARTIAL';

  const txn = db.transaction(() => {
    let saleId: number;
    let invoiceNo: string;
    if (heldId) {
      const held = db.prepare('SELECT id, invoice_no FROM sales WHERE id = ? AND business_id = ? AND status = ?').get(heldId, ctx.businessId, 'HELD') as
        | { id: number; invoice_no: string } | undefined;
      if (!held) throw new AppError('SALE_NOT_FOUND');
      saleId = held.id;
      invoiceNo = held.invoice_no;
      db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
      db.prepare(
        `UPDATE sales SET customer_id = ?, employee_id = ?, subtotal = ?, discount = ?, tax = ?, total = ?, paid = ?, due = ?, change_amount = ?,
         status = 'COMPLETED', held_name = NULL, payment_status = ?, notes = ?, sold_at = ? WHERE id = ?`,
      ).run(customerId, ctx.userId, subtotal, invoiceDiscount, tax, total, paid, due, change, paymentStatus, sanitizeText(input.notes, 1000), soldAt, saleId);
    } else {
      invoiceNo = nextInvoiceNo(db, ctx.businessId);
      const r = db
        .prepare(
          `INSERT INTO sales (business_id, invoice_no, customer_id, employee_id, subtotal, discount, tax, total, paid, due, change_amount,
           status, payment_status, notes, sold_at, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?)`,
        )
        .run(ctx.businessId, invoiceNo, customerId, ctx.userId, subtotal, invoiceDiscount, tax, total, paid, due, change, paymentStatus,
          sanitizeText(input.notes, 1000), soldAt, ctx.userId, nowIso());
      saleId = Number(r.lastInsertRowid);
    }
    const insItem = db.prepare(
      'INSERT INTO sale_items (sale_id, product_id, qty_milli, unit_price, discount, tax, line_total, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insPay = db.prepare('INSERT INTO sale_payments (sale_id, account_id, method, amount, reference, paid_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const ln of lines) {
      const p = db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(ln.product_id) as { purchase_price: number };
      const unitCost = consumeCostLayers(db, ctx.businessId, ln.product_id, ln.qty_milli, p.purchase_price);
      moveStock(db, ctx, ln.product_id, -ln.qty_milli, 'SALE', 'SALE', saleId, `ইনভয়েস ${invoiceNo}`, soldAt);
      insItem.run(saleId, ln.product_id, ln.qty_milli, ln.unit_price, ln.discount ?? 0, ln.tax, ln.line_total, unitCost);
    }
    // Money in (paid portion; walk-in change excluded since paid was clamped to total)
    let remaining = paid;
    for (const pay of payments) {
      if (pay.amount <= 0) continue;
      const take = Math.min(pay.amount, remaining);
      if (take <= 0) continue;
      remaining -= take;
      insPay.run(saleId, pay.account_id, pay.method, take, pay.reference?.trim() || null, soldAt, ctx.userId);
      addMoneyMovement(db, ctx, pay.account_id, 'IN', take, 'SALE', saleId, `বিক্রয় ${invoiceNo}`, soldAt);
    }
    if (customerId) {
      addCustomerLedger(db, ctx, customerId, soldAt, 'SALE', saleId, `বিক্রয় ${invoiceNo}`, total, paid, null);
      if (advance > 0) {
        addCustomerLedger(db, ctx, customerId, soldAt, 'ADVANCE', saleId, `অগ্রিম ${invoiceNo}`, 0, advance, null);
      }
    }
    audit(db, ctx, 'sale.complete', 'sale', saleId, null, { invoice_no: invoiceNo, total, paid, due });
    return { saleId, invoiceNo };
  });
  const { saleId, invoiceNo } = txn();
  refreshStockNotifications(db, ctx.businessId);
  return { id: saleId, invoice_no: invoiceNo, total, paid, due, change_amount: change };
}

// ---------- Held sales ----------

export function holdSale(db: Db, ctx: Ctx, input: { items: CartItemInput[]; customer_id?: number | null; invoice_discount?: number; held_name?: string; notes?: string | null }): { id: number; invoice_no: string } {
  requirePerm(ctx, 'sale.create');
  const canOverride = ctx.permissions.includes('sale.price_override');
  const canDiscount = ctx.permissions.includes('sale.discount');
  const { lines, subtotal, tax: itemTax } = computeCart(db, ctx, input.items, canOverride, canDiscount);
  const invoiceDiscount = input.invoice_discount ?? 0;
  if (!Number.isInteger(invoiceDiscount) || invoiceDiscount < 0 || invoiceDiscount > subtotal) throw new AppError('INVALID_DISCOUNT');
  const cfg = getBusinessCfg(db, ctx.businessId);
  let invoiceTax = 0;
  if (cfg.tax_mode === 'invoice' && cfg.tax_default_bp > 0) invoiceTax = percentOf(subtotal - invoiceDiscount, cfg.tax_default_bp);
  const tax = itemTax + invoiceTax;
  const total = subtotal - invoiceDiscount + tax;
  const now = nowIso();
  const txn = db.transaction(() => {
    const invoiceNo = nextInvoiceNo(db, ctx.businessId);
    const r = db.prepare(
      `INSERT INTO sales (business_id, invoice_no, customer_id, employee_id, subtotal, discount, tax, total, paid, due, change_amount, status, held_name, payment_status, notes, sold_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'HELD', ?, 'DUE', ?, ?, ?, ?)`,
    ).run(ctx.businessId, invoiceNo, input.customer_id ?? null, ctx.userId, subtotal, invoiceDiscount, tax, total, total,
      sanitizeText(input.held_name, 100) || invoiceNo, sanitizeText(input.notes, 1000), now, ctx.userId, now);
    const saleId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO sale_items (sale_id, product_id, qty_milli, unit_price, discount, tax, line_total, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?, 0)');
    for (const ln of lines) ins.run(saleId, ln.product_id, ln.qty_milli, ln.unit_price, ln.discount ?? 0, ln.tax, ln.line_total);
    audit(db, ctx, 'sale.hold', 'sale', saleId, null, { invoice_no: invoiceNo });
    return { id: saleId, invoice_no: invoiceNo };
  });
  return txn();
}

export function listHeld(db: Db, ctx: Ctx): Sale[] {
  return db.prepare(
    `SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.business_id = ? AND s.status = 'HELD' ORDER BY s.id DESC`,
  ).all(ctx.businessId) as Sale[];
}

export function cancelHeld(db: Db, ctx: Ctx, id: number): void {
  requirePerm(ctx, 'sale.create');
  const txn = db.transaction(() => {
    const h = db.prepare("SELECT id FROM sales WHERE id = ? AND business_id = ? AND status = 'HELD'").get(id, ctx.businessId);
    if (!h) throw new AppError('SALE_NOT_FOUND');
    db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(id);
    db.prepare('DELETE FROM sales WHERE id = ?').run(id);
    audit(db, ctx, 'sale.hold_cancel', 'sale', id);
  });
  txn();
}

// ---------- Queries ----------

export function listSales(db: Db, ctx: Ctx, opts: { q?: string; from?: string; to?: string; payment_status?: string; employee_id?: number; include_held?: boolean; include_void?: boolean; page?: number; pageSize?: number }): Paged<Sale> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['s.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (!opts.include_held) where.push("s.status != 'HELD'");
  if (!opts.include_void) where.push("s.status != 'VOID'");
  if (opts.from) { where.push('s.sold_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('s.sold_at <= ?'); params.push(opts.to); }
  if (opts.payment_status) { where.push('s.payment_status = ?'); params.push(opts.payment_status); }
  if (opts.employee_id) { where.push('s.employee_id = ?'); params.push(opts.employee_id); }
  if (opts.q?.trim()) {
    where.push('(s.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)');
    const q = `%${opts.q.trim()}%`;
    params.push(q, q, q);
  }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, u.name AS employee_name FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.employee_id
     WHERE ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Sale[];
  return { rows, total, page, pageSize };
}

export function getSaleDetail(db: Db, ctx: Ctx, id: number): Record<string, unknown> {
  const sale = db.prepare(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, u.name AS employee_name
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.employee_id
     WHERE s.id = ? AND s.business_id = ?`,
  ).get(id, ctx.businessId) as Record<string, unknown> | undefined;
  if (!sale) throw new AppError('SALE_NOT_FOUND');
  const items = db.prepare(
    `SELECT si.*, p.name AS product_name, p.barcode, u.name AS unit_name FROM sale_items si
     JOIN products p ON p.id = si.product_id LEFT JOIN units u ON u.id = p.unit_id WHERE si.sale_id = ?`,
  ).all(id);
  const payments = db.prepare(
    `SELECT sp.*, a.name AS account_name FROM sale_payments sp JOIN financial_accounts a ON a.id = sp.account_id WHERE sp.sale_id = ?`,
  ).all(id);
  return { sale, items, payments };
}

export function voidSale(db: Db, ctx: Ctx, id: number, reason: string): void {
  requirePerm(ctx, 'sale.void');
  if (!reason?.trim()) throw new AppError('REQUIRED');
  const now = nowIso();
  const txn = db.transaction(() => {
    const sale = db.prepare("SELECT * FROM sales WHERE id = ? AND business_id = ? AND status = 'COMPLETED'").get(id, ctx.businessId) as
      | (Sale & { customer_id: number | null }) | undefined;
    if (!sale) {
      const any = db.prepare('SELECT status FROM sales WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as { status: string } | undefined;
      if (any?.status === 'VOID') throw new AppError('SALE_ALREADY_VOID');
      throw new AppError('SALE_NOT_FOUND');
    }
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id) as {
      id: number; product_id: number; qty_milli: number; unit_cost: number; returned_milli: number;
    }[];
    // Restock net quantities (sold minus already returned)
    for (const it of items) {
      const net = it.qty_milli - (it.returned_milli ?? 0);
      if (net > 0) {
        moveStock(db, ctx, it.product_id, net, 'SALE', 'SALE_VOID', id, `বাতিল ${sale.invoice_no}`, now);
        restoreCostLayer(db, ctx.businessId, it.product_id, net, it.unit_cost);
      }
    }
    // Reverse money
    const pays = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(id) as { account_id: number; amount: number }[];
    for (const p of pays) {
      addMoneyMovement(db, ctx, p.account_id, 'OUT', p.amount, 'SALE_VOID', id, `বাতিল ${sale.invoice_no}`, now);
    }
    // Reverse customer ledger
    if (sale.customer_id) {
      addCustomerLedger(db, ctx, sale.customer_id, now, 'SALE_VOID', id, `বাতিল ${sale.invoice_no}`, 0, sale.total, null);
      if (sale.paid > 0) addCustomerLedger(db, ctx, sale.customer_id, now, 'SALE_VOID', id, `বাতিল পেমেন্ট সমন্বয় ${sale.invoice_no}`, sale.paid, 0, null);
    }
    db.prepare('UPDATE sales SET status = ?, due = 0, voided_at = ?, void_reason = ?, voided_by = ? WHERE id = ?').run('VOID', now, reason.trim(), ctx.userId, id);
    audit(db, ctx, 'sale.void', 'sale', id, { invoice_no: sale.invoice_no, total: sale.total }, null, reason.trim());
  });
  txn();
  refreshStockNotifications(db, ctx.businessId);
}

// ---------- Sale returns ----------

export function createSaleReturn(
  db: Db, ctx: Ctx,
  input: { sale_id: number; items: { sale_item_id: number; qty_milli: number }[]; account_id: number; reason?: string; returned_at?: string },
): { id: number; reference: string; total_refund: number } {
  requirePerm(ctx, 'sale.return');
  if (!input.items.length) throw new AppError('INVALID_QTY');
  const acct = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ? AND active = 1').get(input.account_id, ctx.businessId);
  if (!acct) throw new AppError('ACCOUNT_NOT_FOUND');
  const sale = db.prepare("SELECT * FROM sales WHERE id = ? AND business_id = ? AND status = 'COMPLETED'").get(input.sale_id, ctx.businessId) as
    | (Sale & { customer_id: number | null }) | undefined;
  if (!sale) throw new AppError('SALE_NOT_FOUND');
  const at = input.returned_at || nowIso();
  const txn = db.transaction(() => {
    const reference = nextReference(db, ctx.businessId, 'sale_returns', 'SR');
    let totalRefund = 0;
    const lines: { sale_item_id: number; product_id: number; qty_milli: number; refund: number; unit_cost: number }[] = [];
    for (const it of input.items) {
      if (!Number.isInteger(it.qty_milli) || it.qty_milli <= 0) throw new AppError('INVALID_QTY');
      const si = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(it.sale_item_id, input.sale_id) as
        | { id: number; product_id: number; qty_milli: number; line_total: number; returned_milli: number; unit_cost: number } | undefined;
      if (!si) throw new AppError('SALE_NOT_FOUND');
      const available = si.qty_milli - (si.returned_milli ?? 0);
      if (it.qty_milli > available) throw new AppError('RETURN_EXCEEDS_SALE');
      const refund = Math.round((si.line_total * it.qty_milli) / si.qty_milli);
      totalRefund += refund;
      lines.push({ sale_item_id: si.id, product_id: si.product_id, qty_milli: it.qty_milli, refund, unit_cost: si.unit_cost });
    }
    if (totalRefund <= 0) throw new AppError('INVALID_AMOUNT');
    const r = db.prepare(
      'INSERT INTO sale_returns (business_id, reference, sale_id, customer_id, total_refund, account_id, reason, returned_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(ctx.businessId, reference, input.sale_id, sale.customer_id, totalRefund, input.account_id, sanitizeText(input.reason, 500), at, ctx.userId, nowIso());
    const retId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO sale_return_items (sale_return_id, sale_item_id, product_id, qty_milli, refund) VALUES (?, ?, ?, ?, ?)');
    const updItem = db.prepare('UPDATE sale_items SET returned_milli = returned_milli + ? WHERE id = ?');
    for (const ln of lines) {
      ins.run(retId, ln.sale_item_id, ln.product_id, ln.qty_milli, ln.refund);
      updItem.run(ln.qty_milli, ln.sale_item_id);
      moveStock(db, ctx, ln.product_id, ln.qty_milli, 'SALE_RETURN', 'SALE_RETURN', retId, `ফেরত ${reference}`, at);
      restoreCostLayer(db, ctx.businessId, ln.product_id, ln.qty_milli, ln.unit_cost);
    }
    addMoneyMovement(db, ctx, input.account_id, 'OUT', totalRefund, 'SALE_RETURN', retId, `বিক্রয় ফেরত ${reference}`, at);
    if (sale.customer_id) {
      addCustomerLedger(db, ctx, sale.customer_id, at, 'SALE_RETURN', retId, `বিক্রয় ফেরত ${reference}`, 0, totalRefund, null);
    }
    db.prepare('UPDATE sales SET due = MAX(0, due - ?) WHERE id = ?').run(totalRefund, input.sale_id);
    audit(db, ctx, 'sale.return', 'sale_return', retId, null, { reference, total_refund: totalRefund }, sanitizeText(input.reason, 500));
    return { id: retId, reference, total_refund: totalRefund };
  });
  const out = txn();
  refreshStockNotifications(db, ctx.businessId);
  return out;
}

export function listSaleReturns(db: Db, ctx: Ctx, opts: { from?: string; to?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['r.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.from) { where.push('r.returned_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('r.returned_at <= ?'); params.push(opts.to); }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM sale_returns r WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT r.*, s.invoice_no, c.name AS customer_name, a.name AS account_name FROM sale_returns r
     JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN financial_accounts a ON a.id = r.account_id
     WHERE ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}
