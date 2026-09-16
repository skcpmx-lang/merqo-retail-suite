import type { Db } from '../db';
import { AppError, Ctx, audit, requirePerm, paginate, nextReference, addMoneyMovement } from './_helpers';
import { nowIso } from '../../shared/dates';
import { sanitizeText } from '../../shared/validators';
import type { Paged } from '../../shared/types';

/**
 * Manual MFS agent ledger (no live provider integration — truthful bookkeeping only).
 * Cash-flow model per transaction type:
 *  - CASH_IN: customer gives cash, agent's provider balance increases... in bookkeeping terms:
 *      cash account IN (amount+charge received), provider account OUT (e-money sent to customer).
 *  - CASH_OUT: cash OUT to customer, provider account IN (e-money received).
 *  - SEND_MONEY / MERCHANT_PAYMENT / OTHER: provider balance OUT, cash IN (amount+charge), commission tracked as income note.
 * Commission is recorded in the transaction row and summarized in reports.
 */

const PROVIDERS = ['bkash', 'nagad', 'rocket', 'upay'];
const TYPES = ['CASH_IN', 'CASH_OUT', 'SEND_MONEY', 'MERCHANT_PAYMENT', 'OTHER'];

function providerAccountId(db: Db, businessId: number, provider: string): number {
  const code = provider.toUpperCase();
  const row = db.prepare('SELECT id FROM financial_accounts WHERE business_id = ? AND code = ? AND active = 1').get(businessId, code) as { id: number } | undefined;
  if (!row) throw new AppError('ACCOUNT_NOT_FOUND');
  return row.id;
}

export function createMfsTransaction(
  db: Db, ctx: Ctx,
  input: {
    provider: string; txn_type: string; customer_mobile?: string | null; provider_txn_id?: string | null;
    amount: number; charge?: number; commission?: number; cash_account_id?: number | null; notes?: string | null; occurred_at?: string;
  },
): { id: number; reference: string } {
  requirePerm(ctx, 'mfs.create');
  if (!PROVIDERS.includes(input.provider)) throw new AppError('DB_ERROR');
  if (!TYPES.includes(input.txn_type)) throw new AppError('DB_ERROR');
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError('INVALID_AMOUNT');
  const charge = input.charge ?? 0;
  const commission = input.commission ?? 0;
  if (!Number.isInteger(charge) || charge < 0 || !Number.isInteger(commission) || commission < 0) throw new AppError('INVALID_AMOUNT');
  const at = input.occurred_at || nowIso();
  const cashId = input.cash_account_id ?? (db.prepare("SELECT id FROM financial_accounts WHERE business_id = ? AND code = 'CASH'").get(ctx.businessId) as { id: number }).id;
  const cashAcct = db.prepare('SELECT id FROM financial_accounts WHERE id = ? AND business_id = ? AND active = 1').get(cashId, ctx.businessId);
  if (!cashAcct) throw new AppError('ACCOUNT_NOT_FOUND');
  const providerAcct = providerAccountId(db, ctx.businessId, input.provider);

  const txn = db.transaction(() => {
    const reference = nextReference(db, ctx.businessId, 'mfs_transactions', 'MFS');
    const r = db.prepare(
      `INSERT INTO mfs_transactions (business_id, reference, provider, txn_type, customer_mobile, provider_txn_id, amount, charge, commission,
       cash_account_id, provider_account_id, notes, occurred_at, operator_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ctx.businessId, reference, input.provider, input.txn_type, sanitizeText(input.customer_mobile, 20),
      sanitizeText(input.provider_txn_id, 100), input.amount, charge, commission, cashId, providerAcct,
      sanitizeText(input.notes, 500), at, ctx.userId, nowIso());
    const id = Number(r.lastInsertRowid);
    // Mirror cash/provider movements
    if (input.txn_type === 'CASH_IN') {
      addMoneyMovement(db, ctx, cashId, 'IN', input.amount + charge, 'MFS', id, `এজেন্ট ক্যাশ ইন ${reference}`, at);
      addMoneyMovement(db, ctx, providerAcct, 'OUT', input.amount, 'MFS', id, `এজেন্ট ক্যাশ ইন ${reference}`, at);
    } else if (input.txn_type === 'CASH_OUT') {
      addMoneyMovement(db, ctx, cashId, 'OUT', input.amount, 'MFS', id, `এজেন্ট ক্যাশ আউট ${reference}`, at);
      addMoneyMovement(db, ctx, providerAcct, 'IN', input.amount + charge, 'MFS', id, `এজেন্ট ক্যাশ আউট ${reference}`, at);
    } else {
      addMoneyMovement(db, ctx, cashId, 'IN', input.amount + charge, 'MFS', id, `এজেন্ট লেনদেন ${reference}`, at);
      addMoneyMovement(db, ctx, providerAcct, 'OUT', input.amount, 'MFS', id, `এজেন্ট লেনদেন ${reference}`, at);
    }
    audit(db, ctx, 'mfs.create', 'mfs_transaction', id, null, { reference, amount: input.amount });
    return { id, reference };
  });
  return txn();
}

export function listMfsTransactions(
  db: Db, ctx: Ctx,
  opts: { provider?: string; txn_type?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number },
): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['m.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.provider) { where.push('m.provider = ?'); params.push(opts.provider); }
  if (opts.txn_type) { where.push('m.txn_type = ?'); params.push(opts.txn_type); }
  if (opts.from) { where.push('m.occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('m.occurred_at <= ?'); params.push(opts.to); }
  if (opts.q?.trim()) {
    where.push('(m.reference LIKE ? OR m.customer_mobile LIKE ? OR m.provider_txn_id LIKE ?)');
    const q = `%${opts.q.trim()}%`;
    params.push(q, q, q);
  }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM mfs_transactions m WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT m.*, u.name AS operator_name, ca.name AS cash_account_name, pa.name AS provider_account_name FROM mfs_transactions m
     LEFT JOIN users u ON u.id = m.operator_id LEFT JOIN financial_accounts ca ON ca.id = m.cash_account_id LEFT JOIN financial_accounts pa ON pa.id = m.provider_account_id
     WHERE ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

export function mfsSummary(db: Db, ctx: Ctx, from: string, to: string): Record<string, unknown> {
  const byProvider = db.prepare(
    `SELECT provider,
      COUNT(*) AS txn_count,
      COALESCE(SUM(CASE WHEN txn_type = 'CASH_IN' THEN amount ELSE 0 END), 0) AS cash_in,
      COALESCE(SUM(CASE WHEN txn_type = 'CASH_OUT' THEN amount ELSE 0 END), 0) AS cash_out,
      COALESCE(SUM(amount), 0) AS volume,
      COALESCE(SUM(charge), 0) AS charges,
      COALESCE(SUM(commission), 0) AS commission
     FROM mfs_transactions WHERE business_id = ? AND occurred_at >= ? AND occurred_at <= ?
     GROUP BY provider`,
  ).all(ctx.businessId, from, to);
  const total = db.prepare(
    `SELECT COUNT(*) AS txn_count, COALESCE(SUM(amount),0) AS volume, COALESCE(SUM(charge),0) AS charges, COALESCE(SUM(commission),0) AS commission
     FROM mfs_transactions WHERE business_id = ? AND occurred_at >= ? AND occurred_at <= ?`,
  ).get(ctx.businessId, from, to);
  return { byProvider, total };
}
