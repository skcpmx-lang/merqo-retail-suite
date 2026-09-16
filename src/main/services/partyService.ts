import type { Db } from '../db';
import { AppError, Ctx, audit, requirePerm, paginate, nextReference, addMoneyMovement, addCustomerLedger, addSupplierLedger, customerDue, supplierPayable } from './_helpers';
import { nowIso } from '../../shared/dates';
import { sanitizeText, isValidPhoneBD, isValidEmail } from '../../shared/validators';
import type { Customer, LedgerEntry, Paged, Supplier } from '../../shared/types';

// ---------- Customers ----------

export function createCustomer(db: Db, ctx: Ctx, input: { name: string; phone?: string | null; address?: string | null; email?: string | null; opening_due?: number; notes?: string | null }): number {
  requirePerm(ctx, 'customer.create');
  const name = input.name?.trim();
  if (!name) throw new AppError('REQUIRED');
  const opening = input.opening_due ?? 0;
  if (!Number.isInteger(opening) || opening < 0) throw new AppError('INVALID_AMOUNT');
  if (!isValidPhoneBD(input.phone)) throw new AppError('INVALID_PHONE');
  if (!isValidEmail(input.email)) throw new AppError('INVALID_EMAIL');
  const phoneNorm = sanitizeText(input.phone, 20);
  if (phoneNorm) {
    const dup = db.prepare('SELECT id FROM customers WHERE business_id = ? AND phone = ?').get(ctx.businessId, phoneNorm);
    if (dup) throw new AppError('PHONE_DUPLICATE');
  }
  const now = nowIso();
  const txn = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO customers (business_id, name, phone, address, email, opening_due, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(ctx.businessId, name, sanitizeText(input.phone, 20), sanitizeText(input.address, 500), sanitizeText(input.email, 100), opening,
      sanitizeText(input.notes, 1000), 'active', now, now);
    const id = Number(r.lastInsertRowid);
    if (opening > 0) addCustomerLedger(db, ctx, id, now, 'OPENING', null, 'প্রারম্ভিক বকেয়া', opening, 0, null);
    audit(db, ctx, 'customer.create', 'customer', id, null, { name });
    return id;
  });
  return txn();
}

export function updateCustomer(db: Db, ctx: Ctx, id: number, input: Partial<{ name: string; phone: string | null; address: string | null; email: string | null; notes: string | null; status: string }>): void {
  requirePerm(ctx, 'customer.edit');
  const old = db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as Record<string, unknown> | undefined;
  if (!old) throw new AppError('CUSTOMER_NOT_FOUND');
  db.prepare('UPDATE customers SET name = COALESCE(?, name), phone = ?, address = ?, email = ?, notes = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?').run(
    input.name?.trim() || null,
    input.phone !== undefined ? sanitizeText(input.phone, 20) : old.phone,
    input.address !== undefined ? sanitizeText(input.address, 500) : old.address,
    input.email !== undefined ? sanitizeText(input.email, 100) : old.email,
    input.notes !== undefined ? sanitizeText(input.notes, 1000) : old.notes,
    input.status ?? null, nowIso(), id,
  );
  audit(db, ctx, 'customer.update', 'customer', id);
}

export function listCustomers(db: Db, ctx: Ctx, opts: { q?: string; status?: string; has_due?: boolean; sort?: 'due' | 'name'; page?: number; pageSize?: number }): Paged<Customer> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['c.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.q?.trim()) {
    where.push('(c.name LIKE ? OR c.phone LIKE ?)');
    const q = `%${opts.q.trim()}%`;
    params.push(q, q);
  }
  if (opts.status) { where.push('c.status = ?'); params.push(opts.status); }
  if (opts.has_due) where.push('COALESCE((SELECT SUM(debit - credit) FROM customer_ledger l WHERE l.customer_id = c.id), 0) > 0');
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM customers c WHERE ${w}`).get(...params) as { c: number }).c;
  const order = opts.sort === 'due' ? 'current_due DESC, c.name ASC' : 'c.name ASC';
  const rows = db.prepare(
    `SELECT c.*, COALESCE((SELECT SUM(debit - credit) FROM customer_ledger l WHERE l.customer_id = c.id), 0) AS current_due,
       COALESCE((SELECT SUM(sl.total) FROM sales sl WHERE sl.customer_id = c.id AND sl.status = 'COMPLETED'), 0) AS total_purchases,
       COALESCE((SELECT SUM(l.credit) FROM customer_ledger l WHERE l.customer_id = c.id), 0) AS total_payments,
       (SELECT MAX(l.occurred_at) FROM customer_ledger l WHERE l.customer_id = c.id) AS last_activity_at
     FROM customers c WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Customer[];
  return { rows, total, page, pageSize };
}

export function getCustomerProfile(db: Db, ctx: Ctx, id: number): Record<string, unknown> {
  const c = db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as Customer | undefined;
  if (!c) throw new AppError('CUSTOMER_NOT_FOUND');
  const due = customerDue(db, ctx.businessId, id);
  const agg = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN ref_type = 'SALE' THEN debit ELSE 0 END), 0) AS total_purchases,
            COALESCE(SUM(CASE WHEN ref_type IN ('PAYMENT', 'ADVANCE') THEN credit ELSE 0 END), 0) AS total_payments
     FROM customer_ledger WHERE business_id = ? AND customer_id = ?`,
  ).get(ctx.businessId, id) as { total_purchases: number; total_payments: number };
  return { ...c, current_due: due, ...agg };
}

export function customerLedger(db: Db, ctx: Ctx, id: number, opts: { from?: string; to?: string; page?: number; pageSize?: number }): Paged<LedgerEntry> {
  const c = db.prepare('SELECT id FROM customers WHERE id = ? AND business_id = ?').get(id, ctx.businessId);
  if (!c) throw new AppError('CUSTOMER_NOT_FOUND');
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 100);
  const where = ['business_id = ?', 'customer_id = ?'];
  const params: unknown[] = [ctx.businessId, id];
  if (opts.from) { where.push('occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('occurred_at <= ?'); params.push(opts.to); }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM customer_ledger WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`SELECT * FROM customer_ledger WHERE ${w} ORDER BY id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset) as LedgerEntry[];
  return { rows, total, page, pageSize };
}

export function receiveCustomerPayment(
  db: Db, ctx: Ctx,
  input: { customer_id: number; account_id: number; method: string; amount: number; notes?: string | null; paid_at?: string },
): { id: number; reference: string; remaining_due: number } {
  requirePerm(ctx, 'customer.payment');
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError('INVALID_AMOUNT');
  const c = db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(input.customer_id, ctx.businessId) as Customer | undefined;
  if (!c) throw new AppError('CUSTOMER_NOT_FOUND');
  const acct = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ? AND active = 1').get(input.account_id, ctx.businessId);
  if (!acct) throw new AppError('ACCOUNT_NOT_FOUND');
  const at = input.paid_at || nowIso();
  const txn = db.transaction(() => {
    const reference = nextReference(db, ctx.businessId, 'customer_payments', 'CR');
    const r = db.prepare(
      'INSERT INTO customer_payments (business_id, reference, customer_id, account_id, method, amount, notes, paid_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(ctx.businessId, reference, input.customer_id, input.account_id, input.method, input.amount, sanitizeText(input.notes, 500), at, ctx.userId, nowIso());
    const id = Number(r.lastInsertRowid);
    addMoneyMovement(db, ctx, input.account_id, 'IN', input.amount, 'CUSTOMER_PAYMENT', id, `কাস্টমার পেমেন্ট ${reference}`, at);
    const prevDue = customerDue(db, ctx.businessId, input.customer_id);
    addCustomerLedger(db, ctx, input.customer_id, at, 'PAYMENT', id, `পেমেন্ট গ্রহণ ${reference}`, 0, input.amount, input.method);
    audit(db, ctx, 'customer.payment', 'customer_payment', id, { prev_due: prevDue }, { amount: input.amount });
    return { id, reference, remaining_due: prevDue - input.amount };
  });
  return txn();
}

export function listCustomerPayments(db: Db, ctx: Ctx, opts: { customer_id?: number; from?: string; to?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['p.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.customer_id) { where.push('p.customer_id = ?'); params.push(opts.customer_id); }
  if (opts.from) { where.push('p.paid_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('p.paid_at <= ?'); params.push(opts.to); }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM customer_payments p WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT p.*, c.name AS customer_name, a.name AS account_name FROM customer_payments p
     JOIN customers c ON c.id = p.customer_id JOIN financial_accounts a ON a.id = p.account_id
     WHERE ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

// ---------- Suppliers ----------

export function createSupplier(db: Db, ctx: Ctx, input: { name: string; phone?: string | null; address?: string | null; email?: string | null; opening_payable?: number; notes?: string | null }): number {
  requirePerm(ctx, 'supplier.create');
  const name = input.name?.trim();
  if (!name) throw new AppError('REQUIRED');
  const opening = input.opening_payable ?? 0;
  if (!Number.isInteger(opening) || opening < 0) throw new AppError('INVALID_AMOUNT');
  if (!isValidPhoneBD(input.phone)) throw new AppError('INVALID_PHONE');
  if (!isValidEmail(input.email)) throw new AppError('INVALID_EMAIL');
  const phoneNorm = sanitizeText(input.phone, 20);
  if (phoneNorm) {
    const dup = db.prepare('SELECT id FROM suppliers WHERE business_id = ? AND phone = ?').get(ctx.businessId, phoneNorm);
    if (dup) throw new AppError('PHONE_DUPLICATE');
  }
  const now = nowIso();
  const txn = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO suppliers (business_id, name, phone, address, email, opening_payable, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(ctx.businessId, name, sanitizeText(input.phone, 20), sanitizeText(input.address, 500), sanitizeText(input.email, 100), opening,
      sanitizeText(input.notes, 1000), 'active', now, now);
    const id = Number(r.lastInsertRowid);
    if (opening > 0) addSupplierLedger(db, ctx, id, now, 'OPENING', null, 'প্রারম্ভিক দেনা', 0, opening, null);
    audit(db, ctx, 'supplier.create', 'supplier', id, null, { name });
    return id;
  });
  return txn();
}

export function updateSupplier(db: Db, ctx: Ctx, id: number, input: Partial<{ name: string; phone: string | null; address: string | null; email: string | null; notes: string | null; status: string }>): void {
  requirePerm(ctx, 'supplier.edit');
  const old = db.prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as Record<string, unknown> | undefined;
  if (!old) throw new AppError('SUPPLIER_NOT_FOUND');
  db.prepare('UPDATE suppliers SET name = COALESCE(?, name), phone = ?, address = ?, email = ?, notes = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?').run(
    input.name?.trim() || null,
    input.phone !== undefined ? sanitizeText(input.phone, 20) : old.phone,
    input.address !== undefined ? sanitizeText(input.address, 500) : old.address,
    input.email !== undefined ? sanitizeText(input.email, 100) : old.email,
    input.notes !== undefined ? sanitizeText(input.notes, 1000) : old.notes,
    input.status ?? null, nowIso(), id,
  );
  audit(db, ctx, 'supplier.update', 'supplier', id);
}

export function listSuppliers(db: Db, ctx: Ctx, opts: { q?: string; status?: string; has_payable?: boolean; sort?: 'payable' | 'name'; page?: number; pageSize?: number }): Paged<Supplier> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['s.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.q?.trim()) {
    where.push('(s.name LIKE ? OR s.phone LIKE ?)');
    const q = `%${opts.q.trim()}%`;
    params.push(q, q);
  }
  if (opts.status) { where.push('s.status = ?'); params.push(opts.status); }
  if (opts.has_payable) where.push('COALESCE((SELECT SUM(credit - debit) FROM supplier_ledger l WHERE l.supplier_id = s.id), 0) > 0');
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM suppliers s WHERE ${w}`).get(...params) as { c: number }).c;
  const order = opts.sort === 'payable' ? 'current_payable DESC, s.name ASC' : 's.name ASC';
  const rows = db.prepare(
    `SELECT s.*, COALESCE((SELECT SUM(credit - debit) FROM supplier_ledger l WHERE l.supplier_id = s.id), 0) AS current_payable,
       COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'COMPLETED'), 0) AS total_purchases,
       COALESCE((SELECT SUM(l.debit) FROM supplier_ledger l WHERE l.supplier_id = s.id), 0) AS total_payments,
       (SELECT MAX(l.occurred_at) FROM supplier_ledger l WHERE l.supplier_id = s.id) AS last_activity_at
     FROM suppliers s WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Supplier[];
  return { rows, total, page, pageSize };
}

export function getSupplierProfile(db: Db, ctx: Ctx, id: number): Record<string, unknown> {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as Supplier | undefined;
  if (!s) throw new AppError('SUPPLIER_NOT_FOUND');
  const payable = supplierPayable(db, ctx.businessId, id);
  const agg = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN ref_type = 'PURCHASE' THEN credit ELSE 0 END), 0) AS total_purchases,
            COALESCE(SUM(CASE WHEN ref_type = 'PAYMENT' THEN debit ELSE 0 END), 0) AS total_payments
     FROM supplier_ledger WHERE business_id = ? AND supplier_id = ?`,
  ).get(ctx.businessId, id) as { total_purchases: number; total_payments: number };
  return { ...s, current_payable: payable, ...agg };
}

export function supplierLedger(db: Db, ctx: Ctx, id: number, opts: { from?: string; to?: string; page?: number; pageSize?: number }): Paged<LedgerEntry> {
  const s = db.prepare('SELECT id FROM suppliers WHERE id = ? AND business_id = ?').get(id, ctx.businessId);
  if (!s) throw new AppError('SUPPLIER_NOT_FOUND');
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 100);
  const where = ['business_id = ?', 'supplier_id = ?'];
  const params: unknown[] = [ctx.businessId, id];
  if (opts.from) { where.push('occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('occurred_at <= ?'); params.push(opts.to); }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM supplier_ledger WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`SELECT * FROM supplier_ledger WHERE ${w} ORDER BY id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset) as LedgerEntry[];
  return { rows, total, page, pageSize };
}

export function paySupplier(
  db: Db, ctx: Ctx,
  input: { supplier_id: number; account_id: number; method: string; amount: number; notes?: string | null; paid_at?: string },
): { id: number; reference: string; remaining_payable: number } {
  requirePerm(ctx, 'supplier.payment');
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError('INVALID_AMOUNT');
  const s = db.prepare('SELECT id FROM suppliers WHERE id = ? AND business_id = ?').get(input.supplier_id, ctx.businessId);
  if (!s) throw new AppError('SUPPLIER_NOT_FOUND');
  const acct = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ? AND active = 1').get(input.account_id, ctx.businessId);
  if (!acct) throw new AppError('ACCOUNT_NOT_FOUND');
  const at = input.paid_at || nowIso();
  const txn = db.transaction(() => {
    const reference = nextReference(db, ctx.businessId, 'supplier_payments', 'SP');
    const r = db.prepare(
      'INSERT INTO supplier_payments (business_id, reference, supplier_id, account_id, method, amount, notes, paid_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(ctx.businessId, reference, input.supplier_id, input.account_id, input.method, input.amount, sanitizeText(input.notes, 500), at, ctx.userId, nowIso());
    const id = Number(r.lastInsertRowid);
    addMoneyMovement(db, ctx, input.account_id, 'OUT', input.amount, 'SUPPLIER_PAYMENT', id, `সরবরাহকারী পেমেন্ট ${reference}`, at);
    const prev = supplierPayable(db, ctx.businessId, input.supplier_id);
    addSupplierLedger(db, ctx, input.supplier_id, at, 'PAYMENT', id, `পেমেন্ট প্রদান ${reference}`, input.amount, 0, input.method);
    audit(db, ctx, 'supplier.payment', 'supplier_payment', id, { prev_payable: prev }, { amount: input.amount });
    return { id, reference, remaining_payable: prev - input.amount };
  });
  return txn();
}

export function listSupplierPayments(db: Db, ctx: Ctx, opts: { supplier_id?: number; from?: string; to?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['p.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.supplier_id) { where.push('p.supplier_id = ?'); params.push(opts.supplier_id); }
  if (opts.from) { where.push('p.paid_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('p.paid_at <= ?'); params.push(opts.to); }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM supplier_payments p WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT p.*, s.name AS supplier_name, a.name AS account_name FROM supplier_payments p
     JOIN suppliers s ON s.id = p.supplier_id JOIN financial_accounts a ON a.id = p.account_id
     WHERE ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}
