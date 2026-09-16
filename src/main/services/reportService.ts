import type { Db } from '../db';
import { Ctx, paginate } from './_helpers';
import type { Paged } from '../../shared/types';

export interface RangeFilter {
  from: string;
  to: string;
}

function sum(db: Db, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { s: number } | undefined;
  return row?.s ?? 0;
}

// ---------- Dashboard ----------

export function dashboard(db: Db, ctx: Ctx, dayFrom: string, dayTo: string, trendFrom: string, trendTo: string): Record<string, unknown> {
  const b = ctx.businessId;
  const salesToday = sum(db, "SELECT COALESCE(SUM(total),0) AS s FROM sales WHERE business_id = ? AND status = 'COMPLETED' AND sold_at >= ? AND sold_at <= ?", b, dayFrom, dayTo);
  const returnsToday = sum(db, 'SELECT COALESCE(SUM(total_refund),0) AS s FROM sale_returns WHERE business_id = ? AND returned_at >= ? AND returned_at <= ?', b, dayFrom, dayTo);
  const purchaseToday = sum(db, "SELECT COALESCE(SUM(total),0) AS s FROM purchases WHERE business_id = ? AND status = 'COMPLETED' AND purchased_at >= ? AND purchased_at <= ?", b, dayFrom, dayTo);
  const expenseToday = sum(db, 'SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE business_id = ? AND occurred_at >= ? AND occurred_at <= ?', b, dayFrom, dayTo);
  // Gross profit today = (sales - returns) - COGS net
  const cogsToday = sum(db,
    `SELECT COALESCE(SUM((si.qty_milli - si.returned_milli) * si.unit_cost / 1000),0) AS s FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.business_id = ? AND s.status = 'COMPLETED' AND s.sold_at >= ? AND s.sold_at <= ?`, b, dayFrom, dayTo);
  const profitToday = Math.round(salesToday - returnsToday - cogsToday);
  const receivable = sum(db, 'SELECT COALESCE(SUM(debit - credit),0) AS s FROM customer_ledger WHERE business_id = ?', b);
  const payable = sum(db, 'SELECT COALESCE(SUM(credit - debit),0) AS s FROM supplier_ledger WHERE business_id = ?', b);
  const cashRow = db.prepare(
    `SELECT a.opening_balance + COALESCE(SUM(CASE WHEN t.direction = 'IN' THEN t.amount ELSE -t.amount END),0) AS bal
     FROM financial_accounts a LEFT JOIN financial_transactions t ON t.account_id = a.id WHERE a.business_id = ? AND a.code = 'CASH'`,
  ).get(b) as { bal: number };
  const stockValue = Math.round(sum(db, 'SELECT COALESCE(SUM(stock_milli * purchase_price),0) AS s FROM products WHERE business_id = ? AND status = ?', b, 'active') / 1000);

  // Trends per business day (group by date(sold_at) in UTC is close enough for trend display; renderer labels days)
  const salesTrend = db.prepare(
    `SELECT substr(sold_at,1,10) AS day, COALESCE(SUM(total),0) AS total FROM sales
     WHERE business_id = ? AND status = 'COMPLETED' AND sold_at >= ? AND sold_at <= ? GROUP BY day ORDER BY day ASC`,
  ).all(b, trendFrom, trendTo);
  const purchaseTrend = db.prepare(
    `SELECT substr(purchased_at,1,10) AS day, COALESCE(SUM(total),0) AS total FROM purchases
     WHERE business_id = ? AND status = 'COMPLETED' AND purchased_at >= ? AND purchased_at <= ? GROUP BY day ORDER BY day ASC`,
  ).all(b, trendFrom, trendTo);
  const expenseTrend = db.prepare(
    `SELECT substr(occurred_at,1,10) AS day, COALESCE(SUM(amount),0) AS total FROM expenses
     WHERE business_id = ? AND occurred_at >= ? AND occurred_at <= ? GROUP BY day ORDER BY day ASC`,
  ).all(b, trendFrom, trendTo);
  const cashflow = db.prepare(
    `SELECT substr(occurred_at,1,10) AS day,
       COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END),0) AS inflow,
       COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END),0) AS outflow
     FROM financial_transactions WHERE business_id = ? AND occurred_at >= ? AND occurred_at <= ? GROUP BY day ORDER BY day ASC`,
  ).all(b, trendFrom, trendTo);
  const payMethods = db.prepare(
    `SELECT sp.method, COALESCE(SUM(sp.amount),0) AS total FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
     WHERE s.business_id = ? AND s.status = 'COMPLETED' AND s.sold_at >= ? AND s.sold_at <= ? GROUP BY sp.method ORDER BY total DESC`,
  ).all(b, trendFrom, trendTo);
  const topProducts = db.prepare(
    `SELECT p.id, p.name, COALESCE(SUM(si.qty_milli),0) AS qty_milli, COALESCE(SUM(si.line_total),0) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     WHERE s.business_id = ? AND s.status = 'COMPLETED' AND s.sold_at >= ? AND s.sold_at <= ?
     GROUP BY p.id, p.name ORDER BY revenue DESC LIMIT 10`,
  ).all(b, trendFrom, trendTo);
  const lowStock = db.prepare(
    `SELECT id, name, stock_milli, min_stock_milli FROM products WHERE business_id = ? AND status = 'active'
     AND stock_milli > 0 AND min_stock_milli > 0 AND stock_milli <= min_stock_milli ORDER BY stock_milli ASC LIMIT 10`,
  ).all(b);
  const outStock = db.prepare(
    `SELECT id, name FROM products WHERE business_id = ? AND status = 'active' AND stock_milli <= 0 LIMIT 10`,
  ).all(b);
  const topReceivables = db.prepare(
    `SELECT c.id, c.name, COALESCE(SUM(l.debit - l.credit),0) AS due FROM customers c
     LEFT JOIN customer_ledger l ON l.customer_id = c.id WHERE c.business_id = ? GROUP BY c.id, c.name HAVING due > 0 ORDER BY due DESC LIMIT 10`,
  ).all(b);
  const topPayables = db.prepare(
    `SELECT s.id, s.name, COALESCE(SUM(l.credit - l.debit),0) AS payable FROM suppliers s
     LEFT JOIN supplier_ledger l ON l.supplier_id = s.id WHERE s.business_id = ? GROUP BY s.id, s.name HAVING payable > 0 ORDER BY payable DESC LIMIT 10`,
  ).all(b);
  const counts = db.prepare(
    `SELECT (SELECT COUNT(*) FROM sales WHERE business_id = ? AND status = 'COMPLETED') AS sales_count,
            (SELECT COUNT(*) FROM products WHERE business_id = ? AND status = 'active') AS product_count,
            (SELECT COUNT(*) FROM customers WHERE business_id = ?) AS customer_count`,
  ).get(b, b, b);

  return {
    kpi: {
      sales: salesToday - returnsToday, purchases: purchaseToday, profit: profitToday, expenses: expenseToday,
      receivable, payable, cash: cashRow?.bal ?? 0, stockValue,
    },
    salesTrend, purchaseTrend, expenseTrend, cashflow, payMethods, topProducts, lowStock, outStock, topReceivables, topPayables, counts,
  };
}

// ---------- Sales reports ----------

export function salesSummary(db: Db, ctx: Ctx, f: RangeFilter & { group?: 'day' }): Record<string, unknown>[] {
  return db.prepare(
    `SELECT substr(sold_at,1,10) AS day, COUNT(*) AS invoices, COALESCE(SUM(subtotal),0) AS subtotal,
      COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(tax),0) AS tax, COALESCE(SUM(total),0) AS total,
      COALESCE(SUM(paid),0) AS paid, COALESCE(SUM(due),0) AS due
     FROM sales WHERE business_id = ? AND status = 'COMPLETED' AND sold_at >= ? AND sold_at <= ? GROUP BY day ORDER BY day ASC`,
  ).all(ctx.businessId, f.from, f.to) as Record<string, unknown>[];
}

export function salesByProduct(db: Db, ctx: Ctx, f: RangeFilter & { category_id?: number; q?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(f.page ?? 1, f.pageSize ?? 100);
  const where = ['s.business_id = ?', "s.status = 'COMPLETED'", 's.sold_at >= ?', 's.sold_at <= ?'];
  const params: unknown[] = [ctx.businessId, f.from, f.to];
  if (f.category_id) { where.push('p.category_id = ?'); params.push(f.category_id); }
  if (f.q?.trim()) { where.push('p.name LIKE ?'); params.push(`%${f.q.trim()}%`); }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(DISTINCT si.product_id) AS c FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT p.id, p.name, COALESCE(SUM(si.qty_milli),0) AS qty_milli, COALESCE(SUM(si.line_total),0) AS revenue,
      COALESCE(SUM((si.qty_milli - si.returned_milli) * si.unit_cost / 1000),0) AS cogs
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     WHERE ${w} GROUP BY p.id, p.name ORDER BY revenue DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

export function salesByCategory(db: Db, ctx: Ctx, f: RangeFilter): Record<string, unknown>[] {
  return db.prepare(
    `SELECT COALESCE(c.name, '—') AS category, COALESCE(SUM(si.line_total),0) AS revenue, COALESCE(SUM(si.qty_milli),0) AS qty_milli
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE s.business_id = ? AND s.status = 'COMPLETED' AND s.sold_at >= ? AND s.sold_at <= ?
     GROUP BY c.name ORDER BY revenue DESC`,
  ).all(ctx.businessId, f.from, f.to) as Record<string, unknown>[];
}

export function salesByEmployee(db: Db, ctx: Ctx, f: RangeFilter): Record<string, unknown>[] {
  return db.prepare(
    `SELECT COALESCE(u.name, '—') AS employee, COUNT(*) AS invoices, COALESCE(SUM(s.total),0) AS total
     FROM sales s LEFT JOIN users u ON u.id = s.employee_id
     WHERE s.business_id = ? AND s.status = 'COMPLETED' AND s.sold_at >= ? AND s.sold_at <= ? GROUP BY u.name ORDER BY total DESC`,
  ).all(ctx.businessId, f.from, f.to) as Record<string, unknown>[];
}

export function salesByPayment(db: Db, ctx: Ctx, f: RangeFilter): Record<string, unknown>[] {
  return db.prepare(
    `SELECT sp.method, COALESCE(SUM(sp.amount),0) AS total, COUNT(*) AS count FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
     WHERE s.business_id = ? AND s.status = 'COMPLETED' AND s.sold_at >= ? AND s.sold_at <= ? GROUP BY sp.method ORDER BY total DESC`,
  ).all(ctx.businessId, f.from, f.to) as Record<string, unknown>[];
}

export function dueSales(db: Db, ctx: Ctx, f: { page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(f.page ?? 1, f.pageSize ?? 50);
  const total = (db.prepare("SELECT COUNT(*) AS c FROM sales WHERE business_id = ? AND status = 'COMPLETED' AND due > 0").get(ctx.businessId) as { c: number }).c;
  const rows = db.prepare(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.business_id = ? AND s.status = 'COMPLETED' AND s.due > 0 ORDER BY s.sold_at ASC LIMIT ? OFFSET ?`,
  ).all(ctx.businessId, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

// ---------- Purchase reports ----------

export function purchaseSummary(db: Db, ctx: Ctx, f: RangeFilter): Record<string, unknown>[] {
  return db.prepare(
    `SELECT substr(purchased_at,1,10) AS day, COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid),0) AS paid, COALESCE(SUM(due),0) AS due
     FROM purchases WHERE business_id = ? AND status = 'COMPLETED' AND purchased_at >= ? AND purchased_at <= ? GROUP BY day ORDER BY day ASC`,
  ).all(ctx.businessId, f.from, f.to) as Record<string, unknown>[];
}

export function purchaseBySupplier(db: Db, ctx: Ctx, f: RangeFilter): Record<string, unknown>[] {
  return db.prepare(
    `SELECT COALESCE(s.name, '—') AS supplier, COUNT(*) AS count, COALESCE(SUM(p.total),0) AS total, COALESCE(SUM(p.paid),0) AS paid, COALESCE(SUM(p.due),0) AS due
     FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.business_id = ? AND p.status = 'COMPLETED' AND p.purchased_at >= ? AND p.purchased_at <= ? GROUP BY s.name ORDER BY total DESC`,
  ).all(ctx.businessId, f.from, f.to) as Record<string, unknown>[];
}

export function purchaseByProduct(db: Db, ctx: Ctx, f: RangeFilter & { page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(f.page ?? 1, f.pageSize ?? 100);
  const total = (db.prepare(
    `SELECT COUNT(DISTINCT pi.product_id) AS c FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
     WHERE p.business_id = ? AND p.status = 'COMPLETED' AND p.purchased_at >= ? AND p.purchased_at <= ?`,
  ).get(ctx.businessId, f.from, f.to) as { c: number }).c;
  const rows = db.prepare(
    `SELECT pr.name, COALESCE(SUM(pi.qty_milli),0) AS qty_milli, COALESCE(SUM(pi.line_total),0) AS total
     FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id JOIN products pr ON pr.id = pi.product_id
     WHERE p.business_id = ? AND p.status = 'COMPLETED' AND p.purchased_at >= ? AND p.purchased_at <= ?
     GROUP BY pr.name ORDER BY total DESC LIMIT ? OFFSET ?`,
  ).all(ctx.businessId, f.from, f.to, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

// ---------- Inventory reports ----------

export function stockCurrent(db: Db, ctx: Ctx, f: { category_id?: number; q?: string; stock?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(f.page ?? 1, f.pageSize ?? 100);
  const where = ['p.business_id = ?', "p.status = 'active'"];
  const params: unknown[] = [ctx.businessId];
  if (f.category_id) { where.push('p.category_id = ?'); params.push(f.category_id); }
  if (f.q?.trim()) { where.push('p.name LIKE ?'); params.push(`%${f.q.trim()}%`); }
  if (f.stock === 'low') where.push('p.stock_milli > 0 AND p.min_stock_milli > 0 AND p.stock_milli <= p.min_stock_milli');
  if (f.stock === 'out') where.push('p.stock_milli <= 0');
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM products p WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT p.id, p.name, p.sku, p.barcode, p.stock_milli, p.min_stock_milli, p.purchase_price, p.selling_price,
      CAST(p.stock_milli * p.purchase_price / 1000 AS INTEGER) AS stock_value, c.name AS category_name, u.name AS unit_name
     FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN units u ON u.id = p.unit_id
     WHERE ${w} ORDER BY p.name ASC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

export function stockValuation(db: Db, ctx: Ctx): Record<string, unknown> {
  const total = Math.round(sum(db, 'SELECT COALESCE(SUM(stock_milli * purchase_price),0) AS s FROM products WHERE business_id = ? AND status = ?', ctx.businessId, 'active') / 1000);
  const byCategory = db.prepare(
    `SELECT COALESCE(c.name, '—') AS category, CAST(COALESCE(SUM(p.stock_milli * p.purchase_price / 1000),0) AS INTEGER) AS value, COUNT(*) AS items
     FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.business_id = ? AND p.status = 'active' GROUP BY c.name ORDER BY value DESC`,
  ).all(ctx.businessId);
  return { total, byCategory };
}

export function expiryReport(db: Db, ctx: Ctx, withinDays: number): Record<string, unknown>[] {
  const cutoff = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
  return db.prepare(
    `SELECT p.name AS product_name, b.batch_no, b.expiry_date, b.qty_milli FROM product_batches b JOIN products p ON p.id = b.product_id
     WHERE p.business_id = ? AND b.expiry_date IS NOT NULL AND b.expiry_date <= ? AND b.qty_milli > 0 ORDER BY b.expiry_date ASC LIMIT 500`,
  ).all(ctx.businessId, cutoff) as Record<string, unknown>[];
}

export function slowStock(db: Db, ctx: Ctx, days: number): Record<string, unknown>[] {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(
    `SELECT p.id, p.name, p.stock_milli, MAX(s.sold_at) AS last_sold FROM products p
     LEFT JOIN sale_items si ON si.product_id = p.id LEFT JOIN sales s ON s.id = si.sale_id AND s.status = 'COMPLETED'
     WHERE p.business_id = ? AND p.status = 'active' AND p.stock_milli > 0
     GROUP BY p.id, p.name, p.stock_milli HAVING last_sold IS NULL OR last_sold < ? ORDER BY p.stock_milli DESC LIMIT 200`,
  ).all(ctx.businessId, cutoff) as Record<string, unknown>[];
}

// ---------- Financial ----------

export function incomeExpense(db: Db, ctx: Ctx, f: RangeFilter): Record<string, unknown> {
  const revenue = sum(db, "SELECT COALESCE(SUM(total),0) AS s FROM sales WHERE business_id = ? AND status = 'COMPLETED' AND sold_at >= ? AND sold_at <= ?", ctx.businessId, f.from, f.to);
  const saleReturns = sum(db, 'SELECT COALESCE(SUM(total_refund),0) AS s FROM sale_returns WHERE business_id = ? AND returned_at >= ? AND returned_at <= ?', ctx.businessId, f.from, f.to);
  const cogs = sum(db,
    `SELECT COALESCE(SUM((si.qty_milli - si.returned_milli) * si.unit_cost / 1000),0) AS s FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.business_id = ? AND s.status = 'COMPLETED' AND s.sold_at >= ? AND s.sold_at <= ?`, ctx.businessId, f.from, f.to);
  const expenses = sum(db, 'SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE business_id = ? AND occurred_at >= ? AND occurred_at <= ?', ctx.businessId, f.from, f.to);
  const mfsCommission = sum(db, 'SELECT COALESCE(SUM(commission),0) AS s FROM mfs_transactions WHERE business_id = ? AND occurred_at >= ? AND occurred_at <= ?', ctx.businessId, f.from, f.to);
  const byCategory = db.prepare(
    `SELECT COALESCE(c.name, '—') AS category, COALESCE(SUM(e.amount),0) AS total FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     WHERE e.business_id = ? AND e.occurred_at >= ? AND e.occurred_at <= ? GROUP BY c.name ORDER BY total DESC`,
  ).all(ctx.businessId, f.from, f.to);
  const gross = Math.round(revenue - saleReturns - cogs);
  return { revenue: revenue - saleReturns, cogs: Math.round(cogs), gross, expenses, mfsCommission, net: gross - expenses + mfsCommission, byCategory };
}

export function cashflow(db: Db, ctx: Ctx, f: RangeFilter): Record<string, unknown> {
  const rows = db.prepare(
    `SELECT substr(occurred_at,1,10) AS day,
      COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END),0) AS inflow,
      COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END),0) AS outflow
     FROM financial_transactions WHERE business_id = ? AND occurred_at >= ? AND occurred_at <= ? GROUP BY day ORDER BY day ASC`,
  ).all(ctx.businessId, f.from, f.to);
  const byRef = db.prepare(
    `SELECT ref_type, direction, COALESCE(SUM(amount),0) AS total FROM financial_transactions
     WHERE business_id = ? AND occurred_at >= ? AND occurred_at <= ? GROUP BY ref_type, direction ORDER BY total DESC`,
  ).all(ctx.businessId, f.from, f.to);
  return { daily: rows, byRef };
}

export function accountBalances(db: Db, ctx: Ctx): Record<string, unknown>[] {
  return db.prepare(
    `SELECT a.id, a.code, a.name, a.type, a.opening_balance,
      a.opening_balance + COALESCE(SUM(CASE WHEN t.direction = 'IN' THEN t.amount ELSE -t.amount END),0) AS balance
     FROM financial_accounts a LEFT JOIN financial_transactions t ON t.account_id = a.id
     WHERE a.business_id = ? AND a.active = 1 GROUP BY a.id ORDER BY a.id ASC`,
  ).all(ctx.businessId) as Record<string, unknown>[];
}

export function receivables(db: Db, ctx: Ctx, f: { sort?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(f.page ?? 1, f.pageSize ?? 100);
  const total = (db.prepare(
    `SELECT COUNT(*) AS c FROM (SELECT customer_id FROM customer_ledger WHERE business_id = ? GROUP BY customer_id HAVING SUM(debit - credit) > 0)`,
  ).get(ctx.businessId) as { c: number }).c;
  const rows = db.prepare(
    `SELECT c.id, c.name, c.phone, COALESCE(SUM(l.debit - l.credit),0) AS due, MAX(l.occurred_at) AS last_txn
     FROM customers c JOIN customer_ledger l ON l.customer_id = c.id WHERE c.business_id = ?
     GROUP BY c.id, c.name, c.phone HAVING due > 0 ORDER BY due DESC LIMIT ? OFFSET ?`,
  ).all(ctx.businessId, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

export function payables(db: Db, ctx: Ctx, f: { page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  const { limit, offset, page, pageSize } = paginate(f.page ?? 1, f.pageSize ?? 100);
  const total = (db.prepare(
    `SELECT COUNT(*) AS c FROM (SELECT supplier_id FROM supplier_ledger WHERE business_id = ? GROUP BY supplier_id HAVING SUM(credit - debit) > 0)`,
  ).get(ctx.businessId) as { c: number }).c;
  const rows = db.prepare(
    `SELECT s.id, s.name, s.phone, COALESCE(SUM(l.credit - l.debit),0) AS payable, MAX(l.occurred_at) AS last_txn
     FROM suppliers s JOIN supplier_ledger l ON l.supplier_id = s.id WHERE s.business_id = ?
     GROUP BY s.id, s.name, s.phone HAVING payable > 0 ORDER BY payable DESC LIMIT ? OFFSET ?`,
  ).all(ctx.businessId, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}

// ---------- Profit ----------

export function profitReport(db: Db, ctx: Ctx, f: RangeFilter): Record<string, unknown> {
  const inc = incomeExpense(db, ctx, f);
  const byProduct = db.prepare(
    `SELECT p.name, COALESCE(SUM(si.line_total),0) AS revenue,
      CAST(COALESCE(SUM((si.qty_milli - si.returned_milli) * si.unit_cost / 1000),0) AS INTEGER) AS cogs
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     WHERE s.business_id = ? AND s.status = 'COMPLETED' AND s.sold_at >= ? AND s.sold_at <= ?
     GROUP BY p.name ORDER BY revenue DESC LIMIT 100`,
  ).all(ctx.businessId, f.from, f.to);
  const byCategory = db.prepare(
    `SELECT COALESCE(c.name, '—') AS category, COALESCE(SUM(si.line_total),0) AS revenue,
      CAST(COALESCE(SUM((si.qty_milli - si.returned_milli) * si.unit_cost / 1000),0) AS INTEGER) AS cogs
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE s.business_id = ? AND s.status = 'COMPLETED' AND s.sold_at >= ? AND s.sold_at <= ?
     GROUP BY c.name ORDER BY revenue DESC`,
  ).all(ctx.businessId, f.from, f.to);
  return { summary: inc, byProduct, byCategory };
}

// ---------- Global search ----------

export function globalSearch(db: Db, ctx: Ctx, q: string): Record<string, unknown> {
  const query = q.trim();
  if (query.length < 2) return { products: [], customers: [], suppliers: [], invoices: [] };
  const like = `%${query}%`;
  const products = db.prepare('SELECT id, name, barcode, sku, selling_price, stock_milli FROM products WHERE business_id = ? AND (name LIKE ? OR barcode LIKE ? OR sku LIKE ?) LIMIT 8').all(ctx.businessId, like, like, like);
  const customers = db.prepare('SELECT id, name, phone FROM customers WHERE business_id = ? AND (name LIKE ? OR phone LIKE ?) LIMIT 8').all(ctx.businessId, like, like);
  const suppliers = db.prepare('SELECT id, name, phone FROM suppliers WHERE business_id = ? AND (name LIKE ? OR phone LIKE ?) LIMIT 8').all(ctx.businessId, like, like);
  const invoices = db.prepare('SELECT id, invoice_no, total, sold_at FROM sales WHERE business_id = ? AND invoice_no LIKE ? LIMIT 8').all(ctx.businessId, like);
  return { products, customers, suppliers, invoices };
}
