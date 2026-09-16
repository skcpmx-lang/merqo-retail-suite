import type { Db } from '../db';
import { AppError, Ctx, audit, requirePerm, paginate, nextReference, addMoneyMovement, accountBalance } from './_helpers';
import { nowIso } from '../../shared/dates';
import { sanitizeText } from '../../shared/validators';
import type { FinancialAccount, Paged } from '../../shared/types';

export function listAccounts(db: Db, ctx: Ctx): FinancialAccount[] {
  const rows = db.prepare('SELECT * FROM financial_accounts WHERE business_id = ? AND active = 1 ORDER BY id ASC').all(ctx.businessId) as FinancialAccount[];
  return rows.map((r) => ({ ...r, current_balance: accountBalance(db, ctx.businessId, r.id) }));
}

export function getAccount(db: Db, ctx: Ctx, id: number): FinancialAccount {
  const row = db.prepare('SELECT * FROM financial_accounts WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as FinancialAccount | undefined;
  if (!row) throw new AppError('ACCOUNT_NOT_FOUND');
  return { ...row, current_balance: accountBalance(db, ctx.businessId, row.id) };
}

export function createAccount(db: Db, ctx: Ctx, input: { name: string; type?: string; opening_balance?: number }): number {
  requirePerm(ctx, 'account.manage');
  const name = input.name?.trim();
  if (!name) throw new AppError('REQUIRED');
  const opening = input.opening_balance ?? 0;
  if (!Number.isInteger(opening)) throw new AppError('INVALID_AMOUNT');
  const code = 'ACC-' + Date.now().toString(36).toUpperCase();
  const r = db.prepare(
    'INSERT INTO financial_accounts (business_id, code, name, type, opening_balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(ctx.businessId, code, name, input.type || 'other', opening, nowIso(), nowIso());
  const id = Number(r.lastInsertRowid);
  audit(db, ctx, 'account.create', 'financial_account', id, null, { name });
  return id;
}

export function updateAccount(db: Db, ctx: Ctx, id: number, input: { name?: string; active?: boolean }): void {
  requirePerm(ctx, 'account.manage');
  const row = db.prepare('SELECT * FROM financial_accounts WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as FinancialAccount | undefined;
  if (!row) throw new AppError('ACCOUNT_NOT_FOUND');
  db.prepare('UPDATE financial_accounts SET name = COALESCE(?, name), active = COALESCE(?, active), updated_at = ? WHERE id = ?').run(
    input.name?.trim() || null, input.active === undefined ? null : input.active ? 1 : 0, nowIso(), id,
  );
  audit(db, ctx, 'account.update', 'financial_account', id);
}

export function accountTransactions(db: Db, ctx: Ctx, id: number, opts: { from?: string; to?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const row = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ?').get(id, ctx.businessId);
  if (!row) throw new AppError('ACCOUNT_NOT_FOUND');
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 100);
  const where = ['business_id = ?', 'account_id = ?'];
  const params: unknown[] = [ctx.businessId, id];
  if (opts.from) { where.push('occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('occurred_at <= ?'); params.push(opts.to); }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM financial_transactions WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT t.*, u.name AS user_name FROM financial_transactions t LEFT JOIN users u ON u.id = t.created_by WHERE ${w} ORDER BY t.id ASC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

export function transfer(db: Db, ctx: Ctx, input: { from_account_id: number; to_account_id: number; amount: number; notes?: string | null; occurred_at?: string }): { id: number; reference: string } {
  requirePerm(ctx, 'account.transfer');
  if (input.from_account_id === input.to_account_id) throw new AppError('SAME_ACCOUNT');
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError('INVALID_AMOUNT');
  const from = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ? AND active = 1').get(input.from_account_id, ctx.businessId);
  const to = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ? AND active = 1').get(input.to_account_id, ctx.businessId);
  if (!from || !to) throw new AppError('ACCOUNT_NOT_FOUND');
  const at = input.occurred_at || nowIso();
  const txn = db.transaction(() => {
    const reference = nextReference(db, ctx.businessId, 'account_transfers', 'TR');
    const r = db.prepare(
      'INSERT INTO account_transfers (business_id, reference, from_account_id, to_account_id, amount, notes, occurred_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(ctx.businessId, reference, input.from_account_id, input.to_account_id, input.amount, sanitizeText(input.notes, 500), at, ctx.userId, nowIso());
    const id = Number(r.lastInsertRowid);
    addMoneyMovement(db, ctx, input.from_account_id, 'OUT', input.amount, 'TRANSFER', id, `স্থানান্তর ${reference}`, at);
    addMoneyMovement(db, ctx, input.to_account_id, 'IN', input.amount, 'TRANSFER', id, `স্থানান্তর ${reference}`, at);
    audit(db, ctx, 'account.transfer', 'account_transfer', id, null, { reference, amount: input.amount });
    return { id, reference };
  });
  return txn();
}

export function listTransfers(db: Db, ctx: Ctx, opts: { from?: string; to?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['t.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.from) { where.push('t.occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('t.occurred_at <= ?'); params.push(opts.to); }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM account_transfers t WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT t.*, fa.name AS from_name, ta.name AS to_name FROM account_transfers t
     JOIN financial_accounts fa ON fa.id = t.from_account_id JOIN financial_accounts ta ON ta.id = t.to_account_id
     WHERE ${w} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

// ---------- Expenses ----------

export function createExpense(db: Db, ctx: Ctx, input: { category_id?: number | null; amount: number; account_id: number; description?: string | null; reference?: string | null; occurred_at?: string }): number {
  requirePerm(ctx, 'expense.create');
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError('INVALID_AMOUNT');
  const acct = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ? AND active = 1').get(input.account_id, ctx.businessId);
  if (!acct) throw new AppError('ACCOUNT_NOT_FOUND');
  if (input.category_id) {
    const c = db.prepare('SELECT id FROM expense_categories WHERE id = ? AND business_id = ?').get(input.category_id, ctx.businessId);
    if (!c) throw new AppError('DB_ERROR');
  }
  const at = input.occurred_at || nowIso();
  const now = nowIso();
  const txn = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO expenses (business_id, category_id, amount, account_id, description, reference, occurred_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(ctx.businessId, input.category_id ?? null, input.amount, input.account_id, sanitizeText(input.description, 500),
      sanitizeText(input.reference, 100), at, ctx.userId, now, now);
    const id = Number(r.lastInsertRowid);
    addMoneyMovement(db, ctx, input.account_id, 'OUT', input.amount, 'EXPENSE', id, `খরচ: ${sanitizeText(input.description, 200) || 'সাধারণ'}`, at);
    audit(db, ctx, 'expense.create', 'expense', id, null, { amount: input.amount });
    return id;
  });
  return txn();
}

export function updateExpense(db: Db, ctx: Ctx, id: number, input: { category_id?: number | null; amount?: number; account_id?: number; description?: string | null; reference?: string | null; occurred_at?: string }): void {
  requirePerm(ctx, 'expense.edit');
  const old = db.prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as {
    id: number; category_id: number | null; amount: number; account_id: number; description: string | null; reference: string | null; occurred_at: string;
  } | undefined;
  if (!old) throw new AppError('DB_ERROR');
  const amount = input.amount ?? old.amount;
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError('INVALID_AMOUNT');
  const accountId = input.account_id ?? old.account_id;
  const at = input.occurred_at ?? old.occurred_at;
  const txn = db.transaction(() => {
    // Reverse old movement, apply new movement (keeps ledger truthful with visible reversal)
    addMoneyMovement(db, ctx, old.account_id, 'IN', old.amount, 'EXPENSE_REVERSAL', id, 'খরচ সংশোধন (বিপরীত)', nowIso());
    db.prepare('UPDATE expenses SET category_id = ?, amount = ?, account_id = ?, description = ?, reference = ?, occurred_at = ?, updated_at = ? WHERE id = ?').run(
      input.category_id !== undefined ? input.category_id : old.category_id, amount, accountId,
      input.description !== undefined ? sanitizeText(input.description, 500) : old.description,
      input.reference !== undefined ? sanitizeText(input.reference, 100) : old.reference,
      at, nowIso(), id,
    );
    addMoneyMovement(db, ctx, accountId, 'OUT', amount, 'EXPENSE', id, `খরচ: ${sanitizeText(input.description ?? old.description, 200) || 'সাধারণ'}`, at);
    audit(db, ctx, 'expense.update', 'expense', id, old, { amount, account_id: accountId });
  });
  txn();
}

export function deleteExpense(db: Db, ctx: Ctx, id: number): void {
  requirePerm(ctx, 'expense.edit');
  const old = db.prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as { id: number; amount: number; account_id: number } | undefined;
  if (!old) throw new AppError('DB_ERROR');
  const txn = db.transaction(() => {
    addMoneyMovement(db, ctx, old.account_id, 'IN', old.amount, 'EXPENSE_REVERSAL', id, 'খরচ বাতিল (বিপরীত)', nowIso());
    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    audit(db, ctx, 'expense.delete', 'expense', id, { amount: old.amount });
  });
  txn();
}

export function listExpenses(db: Db, ctx: Ctx, opts: { q?: string; category_id?: number; account_id?: number; from?: string; to?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['e.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.category_id) { where.push('e.category_id = ?'); params.push(opts.category_id); }
  if (opts.account_id) { where.push('e.account_id = ?'); params.push(opts.account_id); }
  if (opts.from) { where.push('e.occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('e.occurred_at <= ?'); params.push(opts.to); }
  if (opts.q?.trim()) {
    where.push('(e.description LIKE ? OR e.reference LIKE ?)');
    const q = `%${opts.q.trim()}%`;
    params.push(q, q);
  }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM expenses e WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT e.*, c.name AS category_name, a.name AS account_name FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id JOIN financial_accounts a ON a.id = e.account_id
     WHERE ${w} ORDER BY e.occurred_at DESC, e.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  const sumRow = db.prepare(`SELECT COALESCE(SUM(e.amount), 0) AS s FROM expenses e WHERE ${w}`).get(...params) as { s: number };
  return { rows: rows.map((r) => ({ ...r })), total, page, pageSize, ...( { sum: sumRow.s } as object) } as Paged<Record<string, unknown>>;
}
