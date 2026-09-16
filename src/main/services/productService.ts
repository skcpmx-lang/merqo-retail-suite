import type { Db } from '../db';
import { AppError, Ctx, audit, requirePerm, paginate, moveStock, pushCostLayer, notify, nextReference } from './_helpers';
import { nowIso } from '../../shared/dates';
import { sanitizeText } from '../../shared/validators';
import type { Paged, Product } from '../../shared/types';

function mapUniqueError(e: unknown): never {
  const msg = String(e);
  if (msg.includes('products.barcode') || msg.includes('idx_products_barcode')) throw new AppError('BARCODE_DUPLICATE');
  if (msg.includes('products.sku') || msg.includes('idx_products_sku')) throw new AppError('SKU_DUPLICATE');
  throw new AppError('DB_ERROR');
}

export interface ProductInput {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  category_id?: number | null;
  brand_id?: number | null;
  unit_id?: number | null;
  purchase_price: number;
  selling_price: number;
  wholesale_price?: number;
  min_selling_price?: number;
  min_stock_milli?: number;
  max_stock_milli?: number;
  reorder_milli?: number;
  supplier_id?: number | null;
  tax_bp?: number;
  batch_tracked?: boolean;
  expiry_tracked?: boolean;
  status?: 'active' | 'inactive';
  notes?: string | null;
  opening_stock_milli?: number;
}

function validateInput(p: ProductInput): void {
  if (!p.name?.trim()) throw new AppError('REQUIRED');
  for (const k of ['purchase_price', 'selling_price', 'wholesale_price', 'min_selling_price'] as const) {
    const v = p[k] ?? 0;
    if (!Number.isInteger(v) || v < 0) throw new AppError('INVALID_PRICE');
  }
  if (p.barcode && !/^[A-Za-z0-9\-_.]{3,64}$/.test(p.barcode.trim())) throw new AppError('BARCODE_DUPLICATE');
}

export function createProduct(db: Db, ctx: Ctx, p: ProductInput): number {
  requirePerm(ctx, 'product.create');
  validateInput(p);
  const now = nowIso();
  const sku = sanitizeText(p.sku, 64);
  const barcode = sanitizeText(p.barcode, 64);
  try {
    const txn = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO products (business_id, name, sku, barcode, category_id, brand_id, unit_id, purchase_price, selling_price, wholesale_price,
           min_selling_price, stock_milli, min_stock_milli, max_stock_milli, reorder_milli, supplier_id, tax_bp, batch_tracked, expiry_tracked, status, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ctx.businessId, p.name.trim(), sku, barcode, p.category_id ?? null, p.brand_id ?? null, p.unit_id ?? null,
          p.purchase_price, p.selling_price, p.wholesale_price ?? 0, p.min_selling_price ?? 0,
          p.min_stock_milli ?? 0, p.max_stock_milli ?? 0, p.reorder_milli ?? 0, p.supplier_id ?? null,
          p.tax_bp ?? 0, p.batch_tracked ? 1 : 0, p.expiry_tracked ? 1 : 0, p.status ?? 'active',
          sanitizeText(p.notes, 1000), now, now,
        );
      const id = Number(r.lastInsertRowid);
      if ((p.opening_stock_milli ?? 0) > 0) {
        moveStock(db, ctx, id, p.opening_stock_milli!, 'OPENING', 'OPENING', null, 'প্রারম্ভিক স্টক', now);
        pushCostLayer(db, ctx.businessId, id, null, p.opening_stock_milli!, p.purchase_price);
      }
      audit(db, ctx, 'product.create', 'product', id, null, { name: p.name });
      return id;
    });
    return txn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapUniqueError(e);
  }
}

export function updateProduct(db: Db, ctx: Ctx, id: number, p: Partial<ProductInput>): void {
  requirePerm(ctx, 'product.edit');
  const old = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as Record<string, unknown> | undefined;
  if (!old) throw new AppError('PRODUCT_NOT_FOUND');
  const priceChanged = p.selling_price !== undefined && p.selling_price !== old.selling_price;
  const costChanged = p.purchase_price !== undefined && p.purchase_price !== old.purchase_price;
  try {
    const stmt = db.prepare(
      `UPDATE products SET name = COALESCE(?, name), sku = ?, barcode = ?, category_id = ?, brand_id = ?, unit_id = ?,
       purchase_price = COALESCE(?, purchase_price), selling_price = COALESCE(?, selling_price),
       wholesale_price = COALESCE(?, wholesale_price), min_selling_price = COALESCE(?, min_selling_price),
       min_stock_milli = COALESCE(?, min_stock_milli), max_stock_milli = COALESCE(?, max_stock_milli),
       reorder_milli = COALESCE(?, reorder_milli), supplier_id = ?, tax_bp = COALESCE(?, tax_bp),
       batch_tracked = COALESCE(?, batch_tracked), expiry_tracked = COALESCE(?, expiry_tracked),
       status = COALESCE(?, status), notes = ?, updated_at = ? WHERE id = ?`,
    );
    stmt.run(
      p.name?.trim() || null,
      p.sku !== undefined ? sanitizeText(p.sku, 64) : old.sku,
      p.barcode !== undefined ? sanitizeText(p.barcode, 64) : old.barcode,
      p.category_id !== undefined ? p.category_id : old.category_id,
      p.brand_id !== undefined ? p.brand_id : old.brand_id,
      p.unit_id !== undefined ? p.unit_id : old.unit_id,
      p.purchase_price ?? null, p.selling_price ?? null, p.wholesale_price ?? null, p.min_selling_price ?? null,
      p.min_stock_milli ?? null, p.max_stock_milli ?? null, p.reorder_milli ?? null,
      p.supplier_id !== undefined ? p.supplier_id : old.supplier_id,
      p.tax_bp ?? null,
      p.batch_tracked !== undefined ? (p.batch_tracked ? 1 : 0) : null,
      p.expiry_tracked !== undefined ? (p.expiry_tracked ? 1 : 0) : null,
      p.status ?? null,
      p.notes !== undefined ? sanitizeText(p.notes, 1000) : old.notes,
      nowIso(), id,
    );
    if (priceChanged || costChanged) {
      audit(db, ctx, 'product.price_change', 'product', id,
        { selling_price: old.selling_price, purchase_price: old.purchase_price },
        { selling_price: p.selling_price ?? old.selling_price, purchase_price: p.purchase_price ?? old.purchase_price });
    } else {
      audit(db, ctx, 'product.update', 'product', id);
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapUniqueError(e);
  }
}

export function deleteProduct(db: Db, ctx: Ctx, id: number): void {
  requirePerm(ctx, 'product.delete');
  const used = db.prepare('SELECT COUNT(*) AS c FROM sale_items WHERE product_id = ?').get(id) as { c: number };
  const used2 = db.prepare('SELECT COUNT(*) AS c FROM purchase_items WHERE product_id = ?').get(id) as { c: number };
  if (used.c > 0 || used2.c > 0) throw new AppError('HAS_TRANSACTIONS');
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM cost_layers WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM product_batches WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM inventory_movements WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM products WHERE id = ? AND business_id = ?').run(id, ctx.businessId);
    audit(db, ctx, 'product.delete', 'product', id);
  });
  txn();
}

export function listProducts(
  db: Db, ctx: Ctx,
  opts: { q?: string; category_id?: number; brand_id?: string | number; status?: string; stock?: 'all' | 'low' | 'out' | 'over'; page?: number; pageSize?: number },
): Paged<Product> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where: string[] = ['p.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.q?.trim()) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
    const q = `%${opts.q.trim()}%`;
    params.push(q, q, q);
  }
  if (opts.category_id) { where.push('p.category_id = ?'); params.push(opts.category_id); }
  if (opts.brand_id) { where.push('p.brand_id = ?'); params.push(opts.brand_id); }
  if (opts.status) { where.push('p.status = ?'); params.push(opts.status); }
  if (opts.stock === 'low') where.push('p.stock_milli > 0 AND p.stock_milli <= p.min_stock_milli AND p.min_stock_milli > 0');
  if (opts.stock === 'out') where.push('p.stock_milli <= 0');
  if (opts.stock === 'over') where.push('p.max_stock_milli > 0 AND p.stock_milli > p.max_stock_milli');
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM products p WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT p.*, c.name AS category_name, b.name AS brand_name, u.name AS unit_name
     FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN units u ON u.id = p.unit_id
     WHERE ${w} ORDER BY p.name ASC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Product[];
  return { rows, total, page, pageSize };
}

export function getProductById(db: Db, ctx: Ctx, id: number): Product {
  const row = db.prepare(
    `SELECT p.*, c.name AS category_name, b.name AS brand_name, u.name AS unit_name FROM products p
     LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.id = ? AND p.business_id = ?`,
  ).get(id, ctx.businessId) as Product | undefined;
  if (!row) throw new AppError('PRODUCT_NOT_FOUND');
  return row;
}

export function findByBarcode(db: Db, ctx: Ctx, code: string): Product {
  const c = code.trim();
  const row = db.prepare(
    `SELECT p.*, u.name AS unit_name FROM products p LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.business_id = ? AND p.status = 'active' AND (p.barcode = ? OR p.sku = ?)`,
  ).get(ctx.businessId, c, c) as Product | undefined;
  if (!row) throw new AppError('PRODUCT_NOT_FOUND');
  return row;
}

/** POS fast search: name/sku/barcode, active only, limited. */
export function searchProducts(db: Db, ctx: Ctx, q: string, limit = 30): Product[] {
  const query = q.trim();
  if (!query) return [];
  return db.prepare(
    `SELECT p.*, u.name AS unit_name FROM products p LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.business_id = ? AND p.status = 'active' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)
     ORDER BY CASE WHEN p.barcode = ? THEN 0 WHEN p.sku = ? THEN 1 ELSE 2 END, p.name ASC LIMIT ?`,
  ).all(ctx.businessId, `%${query}%`, `%${query}%`, `%${query}%`, query, query, Math.min(limit, 100)) as Product[];
}

// ---------- Master data ----------

export function listMaster(db: Db, ctx: Ctx, table: 'categories' | 'brands' | 'units' | 'expense_categories'): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM ${table} WHERE business_id = ? ORDER BY name ASC`).all(ctx.businessId) as Record<string, unknown>[];
}

export function createMaster(db: Db, ctx: Ctx, table: 'categories' | 'brands' | 'units' | 'expense_categories', name: string, extra?: Record<string, unknown>): number {
  requirePerm(ctx, table === 'expense_categories' ? 'expense.create' : 'product.create');
  const n = name?.trim();
  if (!n) throw new AppError('REQUIRED');
  try {
    if (table === 'categories') {
      const r = db.prepare('INSERT INTO categories (business_id, name, parent_id, created_at) VALUES (?, ?, ?, ?)').run(ctx.businessId, n, (extra?.parent_id as number) ?? null, nowIso());
      return Number(r.lastInsertRowid);
    }
    if (table === 'brands') {
      const r = db.prepare('INSERT INTO brands (business_id, name, created_at) VALUES (?, ?, ?)').run(ctx.businessId, n, nowIso());
      return Number(r.lastInsertRowid);
    }
    if (table === 'units') {
      const r = db.prepare('INSERT INTO units (business_id, name, allow_fraction, created_at) VALUES (?, ?, ?, ?)').run(ctx.businessId, n, extra?.allow_fraction === 0 ? 0 : 1, nowIso());
      return Number(r.lastInsertRowid);
    }
    const r = db.prepare('INSERT INTO expense_categories (business_id, name, created_at) VALUES (?, ?, ?)').run(ctx.businessId, n, nowIso());
    return Number(r.lastInsertRowid);
  } catch {
    throw new AppError('DB_ERROR');
  }
  throw new AppError('DB_ERROR');
}

export function renameMaster(db: Db, ctx: Ctx, table: 'categories' | 'brands' | 'units' | 'expense_categories', id: number, name: string): void {
  requirePerm(ctx, table === 'expense_categories' ? 'expense.edit' : 'product.edit');
  const n = name?.trim();
  if (!n) throw new AppError('REQUIRED');
  db.prepare(`UPDATE ${table} SET name = ? WHERE id = ? AND business_id = ?`).run(n, id, ctx.businessId);
}

export function deleteMaster(db: Db, ctx: Ctx, table: 'categories' | 'brands' | 'units' | 'expense_categories', id: number): void {
  requirePerm(ctx, 'product.delete');
  if (table === 'categories') {
    const c = db.prepare('SELECT COUNT(*) AS c FROM products WHERE category_id = ?').get(id) as { c: number };
    if (c.c > 0) throw new AppError('HAS_TRANSACTIONS');
  }
  if (table === 'brands') {
    const c = db.prepare('SELECT COUNT(*) AS c FROM products WHERE brand_id = ?').get(id) as { c: number };
    if (c.c > 0) throw new AppError('HAS_TRANSACTIONS');
  }
  if (table === 'units') {
    const c = db.prepare('SELECT COUNT(*) AS c FROM products WHERE unit_id = ?').get(id) as { c: number };
    if (c.c > 0) throw new AppError('HAS_TRANSACTIONS');
  }
  if (table === 'expense_categories') {
    const c = db.prepare('SELECT COUNT(*) AS c FROM expenses WHERE category_id = ?').get(id) as { c: number };
    if (c.c > 0) throw new AppError('HAS_TRANSACTIONS');
  }
  db.prepare(`DELETE FROM ${table} WHERE id = ? AND business_id = ?`).run(id, ctx.businessId);
}

// ---------- Stock operations ----------

export function adjustStock(db: Db, ctx: Ctx, productId: number, newMilli: number, reason: string): void {
  requirePerm(ctx, 'inventory.adjust');
  if (!Number.isInteger(newMilli) || newMilli < 0) throw new AppError('INVALID_QTY');
  if (!reason?.trim()) throw new AppError('REQUIRED');
  const p = db.prepare('SELECT stock_milli, name, purchase_price FROM products WHERE id = ? AND business_id = ?').get(productId, ctx.businessId) as
    | { stock_milli: number; name: string; purchase_price: number } | undefined;
  if (!p) throw new AppError('PRODUCT_NOT_FOUND');
  const delta = newMilli - p.stock_milli;
  const txn = db.transaction(() => {
    moveStock(db, ctx, productId, delta, 'ADJUSTMENT', 'ADJUSTMENT', null, reason.trim(), nowIso());
    if (delta > 0) pushCostLayer(db, ctx.businessId, productId, null, delta, p.purchase_price);
    audit(db, ctx, 'inventory.adjust', 'product', productId, { stock_milli: p.stock_milli }, { stock_milli: newMilli }, reason.trim());
  });
  txn();
}

export function recordDamageLoss(db: Db, ctx: Ctx, productId: number, qtyMilli: number, type: 'DAMAGE' | 'LOST', reason: string): void {
  requirePerm(ctx, 'inventory.adjust');
  if (!Number.isInteger(qtyMilli) || qtyMilli <= 0) throw new AppError('INVALID_QTY');
  const txn = db.transaction(() => {
    moveStock(db, ctx, productId, -qtyMilli, type, type, null, reason?.trim() || null, nowIso());
    audit(db, ctx, 'inventory.damage_loss', 'product', productId, null, { qty_milli: qtyMilli, type }, reason?.trim());
  });
  txn();
}

export function saveStockCount(db: Db, ctx: Ctx, items: { product_id: number; counted_milli: number }[], notes?: string): string {
  requirePerm(ctx, 'inventory.count');
  if (!items.length) throw new AppError('INVALID_QTY');
  const now = nowIso();
  let reference = '';
  const txn = db.transaction(() => {
    const { nextReference } = require('./_helpers') as typeof import('./_helpers');
    reference = nextReference(db, ctx.businessId, 'stock_counts', 'STC');
    const r = db.prepare('INSERT INTO stock_counts (business_id, reference, notes, counted_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      ctx.businessId, reference, notes?.trim() || null, now, ctx.userId, now,
    );
    const countId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO stock_count_items (stock_count_id, product_id, system_milli, counted_milli, diff_milli) VALUES (?, ?, ?, ?, ?)');
    for (const it of items) {
      const p = db.prepare('SELECT stock_milli, purchase_price FROM products WHERE id = ? AND business_id = ?').get(it.product_id, ctx.businessId) as
        | { stock_milli: number; purchase_price: number } | undefined;
      if (!p) throw new AppError('PRODUCT_NOT_FOUND');
      const diff = it.counted_milli - p.stock_milli;
      ins.run(countId, it.product_id, p.stock_milli, it.counted_milli, diff);
      if (diff !== 0) {
        moveStock(db, ctx, it.product_id, diff, 'COUNT', 'STOCK_COUNT', countId, `গণনা ${reference}`, now);
        if (diff > 0) pushCostLayer(db, ctx.businessId, it.product_id, null, diff, p.purchase_price);
      }
    }
    audit(db, ctx, 'inventory.count', 'stock_count', countId, null, { reference, items: items.length });
  });
  txn();
  // Low-stock notifications refresh
  refreshStockNotifications(db, ctx.businessId);
  return reference;
}

export function listMovements(db: Db, ctx: Ctx, opts: { product_id?: number; type?: string; from?: string; to?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['m.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.product_id) { where.push('m.product_id = ?'); params.push(opts.product_id); }
  if (opts.type) { where.push('m.type = ?'); params.push(opts.type); }
  if (opts.from) { where.push('m.occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('m.occurred_at <= ?'); params.push(opts.to); }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM inventory_movements m WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT m.*, p.name AS product_name, u.name AS user_name FROM inventory_movements m
     LEFT JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.created_by
     WHERE ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

export function stockAlerts(db: Db, businessId: number): { low: number; out: number; expiring: number } {
  const low = db.prepare(
    'SELECT COUNT(*) AS c FROM products WHERE business_id = ? AND status = ? AND stock_milli > 0 AND min_stock_milli > 0 AND stock_milli <= min_stock_milli',
  ).get(businessId, 'active') as { c: number };
  const out = db.prepare('SELECT COUNT(*) AS c FROM products WHERE business_id = ? AND status = ? AND stock_milli <= 0').get(businessId, 'active') as { c: number };
  const days = 30;
  const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const exp = db.prepare(
    `SELECT COUNT(*) AS c FROM product_batches b JOIN products p ON p.id = b.product_id
     WHERE p.business_id = ? AND b.expiry_date IS NOT NULL AND b.expiry_date <= ? AND b.qty_milli > 0`,
  ).get(businessId, cutoff) as { c: number };
  return { low: low.c, out: out.c, expiring: exp.c };
}

export function refreshStockNotifications(db: Db, businessId: number): void {
  const lows = db.prepare(
    'SELECT id, name, stock_milli FROM products WHERE business_id = ? AND status = ? AND stock_milli > 0 AND min_stock_milli > 0 AND stock_milli <= min_stock_milli LIMIT 50',
  ).all(businessId, 'active') as { id: number; name: string }[];
  for (const p of lows) {
    notify(db, businessId, 'low_stock', 'warning', 'স্টক কমে গেছে', `“${p.name}” পণ্যের স্টক কম। পুনরায় ক্রয়ের ব্যবস্থা করুন।`, `low-${p.id}`);
  }
  const outs = db.prepare('SELECT id, name FROM products WHERE business_id = ? AND status = ? AND stock_milli <= 0 LIMIT 50').all(businessId, 'active') as {
    id: number; name: string;
  }[];
  for (const p of outs) {
    notify(db, businessId, 'out_of_stock', 'critical', 'স্টক শেষ', `“${p.name}” পণ্যের স্টক শেষ হয়ে গেছে।`, `out-${p.id}`);
  }
}

// ---------- Batches / expiry ----------

export function listBatches(db: Db, ctx: Ctx, productId: number): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC, id ASC').all(productId) as Record<string, unknown>[];
}

export function addBatch(db: Db, ctx: Ctx, productId: number, batchNo: string | null, expiryDate: string | null, qtyMilli: number, unitCost: number): void {
  requirePerm(ctx, 'inventory.adjust');
  const p = db.prepare('SELECT id FROM products WHERE id = ? AND business_id = ?').get(productId, ctx.businessId);
  if (!p) throw new AppError('PRODUCT_NOT_FOUND');
  const txn = db.transaction(() => {
    db.prepare('INSERT INTO product_batches (product_id, batch_no, expiry_date, qty_milli, unit_cost, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      productId, batchNo?.trim() || null, expiryDate || null, qtyMilli, unitCost, nowIso(),
    );
  });
  txn();
}
