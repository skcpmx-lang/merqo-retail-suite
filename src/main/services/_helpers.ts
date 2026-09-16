import type { Db } from '../db';
import { nowIso, todayYMD } from '../../shared/dates';

export class AppError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export interface Ctx {
  businessId: number;
  userId: number | null;
  permissions: string[];
}

export function requirePerm(ctx: Ctx, key: string): void {
  if (!ctx.permissions.includes(key)) throw new AppError('NO_PERMISSION');
}

export function audit(
  db: Db,
  ctx: Ctx,
  action: string,
  entity: string,
  entityId: number | null,
  oldValue?: unknown,
  newValue?: unknown,
  reason?: string | null,
): void {
  db.prepare(
    'INSERT INTO audit_logs (business_id, user_id, occurred_at, action, entity, entity_id, old_value, new_value, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    ctx.businessId,
    ctx.userId,
    nowIso(),
    action,
    entity,
    entityId,
    oldValue === undefined ? null : JSON.stringify(oldValue),
    newValue === undefined ? null : JSON.stringify(newValue),
    reason ?? null,
  );
}

export function notify(
  db: Db,
  businessId: number,
  type: string,
  priority: 'info' | 'warning' | 'critical',
  title: string,
  message: string,
  dedupeKey?: string,
): void {
  if (dedupeKey) {
    const existing = db
      .prepare('SELECT id FROM notifications WHERE business_id = ? AND dedupe_key = ? AND read_at IS NULL')
      .get(businessId, dedupeKey);
    if (existing) return;
  }
  db.prepare(
    'INSERT INTO notifications (business_id, type, priority, title, message, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(businessId, type, priority, title, message, dedupeKey ?? null, nowIso());
}

/** Generate the next invoice number like MERQO-2026-000001 (transaction-safe via row update). */
export function nextInvoiceNo(db: Db, businessId: number): string {
  const biz = db.prepare('SELECT invoice_prefix, invoice_next_no FROM businesses WHERE id = ?').get(businessId) as {
    invoice_prefix: string;
    invoice_next_no: number;
  };
  const year = todayYMD().slice(0, 4);
  const no = `${biz.invoice_prefix}-${year}-${String(biz.invoice_next_no).padStart(6, '0')}`;
  db.prepare('UPDATE businesses SET invoice_next_no = invoice_next_no + 1, updated_at = ? WHERE id = ?').run(nowIso(), businessId);
  return no;
}

/** Generic dated reference: PREFIX-YYYYMMDD-#### per business+table. */
export function nextReference(db: Db, businessId: number, table: string, prefix: string): string {
  const day = todayYMD().replace(/-/g, '');
  const row = db
    .prepare(`SELECT reference FROM ${table} WHERE business_id = ? AND reference LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(businessId, `${prefix}-${day}-%`) as { reference: string } | undefined;
  let seq = 1;
  if (row) {
    const m = row.reference.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}-${day}-${String(seq).padStart(4, '0')}`;
}

export function paginate(page: number, pageSize: number): { limit: number; offset: number; page: number; pageSize: number } {
  const p = Math.max(1, Math.floor(page) || 1);
  const ps = Math.min(500, Math.max(1, Math.floor(pageSize) || 50));
  return { limit: ps, offset: (p - 1) * ps, page: p, pageSize: ps };
}

// ---------- Balances: single source of truth ----------

export function accountBalance(db: Db, businessId: number, accountId: number): number {
  const row = db
    .prepare(
      `SELECT a.opening_balance + COALESCE(SUM(CASE WHEN t.direction = 'IN' THEN t.amount ELSE -t.amount END), 0) AS bal
       FROM financial_accounts a LEFT JOIN financial_transactions t ON t.account_id = a.id
       WHERE a.id = ? AND a.business_id = ?`,
    )
    .get(accountId, businessId) as { bal: number };
  return row?.bal ?? 0;
}

export function addMoneyMovement(
  db: Db,
  ctx: Ctx,
  accountId: number,
  direction: 'IN' | 'OUT',
  amount: number,
  refType: string,
  refId: number | null,
  description: string,
  occurredAt: string,
): void {
  if (amount < 0) throw new AppError('INVALID_AMOUNT');
  if (amount === 0) return;
  db.prepare(
    'INSERT INTO financial_transactions (business_id, account_id, direction, amount, ref_type, ref_id, description, occurred_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(ctx.businessId, accountId, direction, amount, refType, refId, description, occurredAt, ctx.userId, nowIso());
}

export function customerDue(db: Db, businessId: number, customerId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(debit - credit), 0) AS bal FROM customer_ledger WHERE business_id = ? AND customer_id = ?')
    .get(businessId, customerId) as { bal: number };
  return row?.bal ?? 0;
}

export function supplierPayable(db: Db, businessId: number, supplierId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(credit - debit), 0) AS bal FROM supplier_ledger WHERE business_id = ? AND supplier_id = ?')
    .get(businessId, supplierId) as { bal: number };
  return row?.bal ?? 0;
}

export function addCustomerLedger(
  db: Db,
  ctx: Ctx,
  customerId: number,
  occurredAt: string,
  refType: string,
  refId: number | null,
  description: string,
  debit: number,
  credit: number,
  method?: string | null,
): void {
  const prev = customerDue(db, ctx.businessId, customerId);
  const balance = prev + debit - credit;
  db.prepare(
    'INSERT INTO customer_ledger (business_id, customer_id, occurred_at, ref_type, ref_id, description, debit, credit, balance, method, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(ctx.businessId, customerId, occurredAt, refType, refId, description, debit, credit, balance, method ?? null, ctx.userId, nowIso());
}

export function addSupplierLedger(
  db: Db,
  ctx: Ctx,
  supplierId: number,
  occurredAt: string,
  refType: string,
  refId: number | null,
  description: string,
  debit: number,
  credit: number,
  method?: string | null,
): void {
  const prev = supplierPayable(db, ctx.businessId, supplierId);
  const balance = prev + credit - debit;
  db.prepare(
    'INSERT INTO supplier_ledger (business_id, supplier_id, occurred_at, ref_type, ref_id, description, debit, credit, balance, method, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(ctx.businessId, supplierId, occurredAt, refType, refId, description, debit, credit, balance, method ?? null, ctx.userId, nowIso());
}

// ---------- Inventory ----------

export function getProduct(db: Db, businessId: number, productId: number): Record<string, never> & {
  id: number;
  name: string;
  stock_milli: number;
  status: string;
  selling_price: number;
  purchase_price: number;
  tax_bp: number;
} {
  const p = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(productId, businessId) as
    | (Record<string, never> & { id: number; name: string; stock_milli: number; status: string; selling_price: number; purchase_price: number; tax_bp: number })
    | undefined;
  if (!p) throw new AppError('PRODUCT_NOT_FOUND');
  return p;
}

/** Adjust stock and record movement. Returns new stock. Enforces negative-stock policy. */
export function moveStock(
  db: Db,
  ctx: Ctx,
  productId: number,
  deltaMilli: number,
  type: string,
  refType: string,
  refId: number | null,
  reason: string | null,
  occurredAt: string,
): number {
  const p = getProduct(db, ctx.businessId, productId);
  const prev = p.stock_milli;
  const next = prev + deltaMilli;
  if (next < 0) {
    const biz = db.prepare('SELECT negative_stock_allowed FROM businesses WHERE id = ?').get(ctx.businessId) as {
      negative_stock_allowed: number;
    };
    if (!biz?.negative_stock_allowed) throw new AppError('NEGATIVE_STOCK_BLOCKED');
  }
  db.prepare('UPDATE products SET stock_milli = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), productId);
  db.prepare(
    'INSERT INTO inventory_movements (business_id, product_id, type, qty_milli, prev_milli, new_milli, ref_type, ref_id, reason, occurred_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(ctx.businessId, productId, type, deltaMilli, prev, next, refType, refId, reason, occurredAt, ctx.userId);
  return next;
}

/** FIFO: push a cost layer (purchase). */
export function pushCostLayer(db: Db, businessId: number, productId: number, purchaseId: number | null, qtyMilli: number, unitCost: number): void {
  if (qtyMilli <= 0) return;
  db.prepare('INSERT INTO cost_layers (business_id, product_id, purchase_id, qty_milli_remaining, unit_cost, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    businessId,
    productId,
    purchaseId,
    qtyMilli,
    unitCost,
    nowIso(),
  );
}

/**
 * FIFO: consume layers for a sale. Returns weighted-average unit cost (paisa per unit).
 * If stock exists without layers (opening stock), falls back to product purchase_price.
 */
export function consumeCostLayers(db: Db, businessId: number, productId: number, qtyMilli: number, fallbackUnitCost: number): number {
  if (qtyMilli <= 0) return 0;
  let remaining = qtyMilli;
  let costAccum = 0; // paisa * milli
  const layers = db
    .prepare('SELECT id, qty_milli_remaining, unit_cost FROM cost_layers WHERE business_id = ? AND product_id = ? AND qty_milli_remaining > 0 ORDER BY id ASC')
    .all(businessId, productId) as { id: number; qty_milli_remaining: number; unit_cost: number }[];
  const upd = db.prepare('UPDATE cost_layers SET qty_milli_remaining = ? WHERE id = ?');
  for (const l of layers) {
    if (remaining <= 0) break;
    const take = Math.min(l.qty_milli_remaining, remaining);
    costAccum += take * l.unit_cost;
    upd.run(l.qty_milli_remaining - take, l.id);
    remaining -= take;
  }
  if (remaining > 0) {
    costAccum += remaining * fallbackUnitCost;
  }
  return Math.round(costAccum / qtyMilli);
}

/** Restore layers (sale return restocks at original cost; purchase return removes newest first). */
export function restoreCostLayer(db: Db, businessId: number, productId: number, qtyMilli: number, unitCost: number): void {
  pushCostLayer(db, businessId, productId, null, qtyMilli, unitCost);
}

export function removeNewestCostLayers(db: Db, businessId: number, productId: number, qtyMilli: number): void {
  let remaining = qtyMilli;
  const layers = db
    .prepare('SELECT id, qty_milli_remaining FROM cost_layers WHERE business_id = ? AND product_id = ? AND qty_milli_remaining > 0 ORDER BY id DESC')
    .all(businessId, productId) as { id: number; qty_milli_remaining: number }[];
  const upd = db.prepare('UPDATE cost_layers SET qty_milli_remaining = ? WHERE id = ?');
  for (const l of layers) {
    if (remaining <= 0) break;
    const take = Math.min(l.qty_milli_remaining, remaining);
    upd.run(l.qty_milli_remaining - take, l.id);
    remaining -= take;
  }
}

export function getSetting(db: Db, businessId: number, key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE business_id = ? AND key = ?').get(businessId, key) as { value: string } | undefined;
  return row?.value ?? fallback;
}
