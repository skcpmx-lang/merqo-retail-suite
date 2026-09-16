import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { Db } from '../db';
import { AppError, Ctx, audit, requirePerm } from './_helpers';
import { getPaths } from '../paths';
import { nowIso } from '../../shared/dates';
import { toPaisa } from '../../shared/money';
import { toMilli } from '../../shared/qty';
import { sanitizeText } from '../../shared/validators';

/** Minimal RFC-4180 CSV parser (handles quotes/escapes). Never executes content. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (ch === '\r') {
      /* skip */
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function readInputFile(file: string): string[][] {
  if (!fs.existsSync(file)) throw new AppError('IMPORT_EMPTY');
  const st = fs.statSync(file);
  if (st.size > 10 * 1024 * 1024) throw new AppError('IMPORT_EMPTY');
  const ext = path.extname(file).toLowerCase();
  if (!['.csv', '.txt'].includes(ext)) throw new AppError('IMPORT_EMPTY');
  const text = fs.readFileSync(file, 'utf8');
  if (text.length > 10 * 1024 * 1024) throw new AppError('IMPORT_EMPTY');
  return parseCsv(text);
}

export interface ImportPreview {
  headers: string[];
  rows: Record<string, string>[];
  errors: { row: number; message: string }[];
  validCount: number;
}

function toPreview(headers: string[], data: string[][], validate: (rec: Record<string, string>, idx: number) => string | null): ImportPreview {
  const rows: Record<string, string>[] = [];
  const errors: { row: number; message: string }[] = [];
  data.forEach((cells, i) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, j) => { rec[h] = (cells[j] ?? '').trim(); });
    rows.push(rec);
    const err = validate(rec, i + 2);
    if (err) errors.push({ row: i + 2, message: err });
  });
  return { headers, rows, errors, validCount: rows.length - errors.length };
}

export const PRODUCT_TEMPLATE = ['name', 'sku', 'barcode', 'category', 'brand', 'unit', 'purchase_price', 'selling_price', 'opening_stock', 'min_stock'];
export const CUSTOMER_TEMPLATE = ['name', 'phone', 'address', 'opening_due'];
export const SUPPLIER_TEMPLATE = ['name', 'phone', 'address', 'opening_payable'];

export function previewImport(db: Db, ctx: Ctx, kind: 'products' | 'customers' | 'suppliers', file: string): ImportPreview {
  requirePerm(ctx, 'import.run');
  const grid = readInputFile(file);
  if (grid.length < 2) throw new AppError('IMPORT_EMPTY');
  const headers = grid[0].map((h) => h.trim().toLowerCase());
  const data = grid.slice(1, 5001);
  if (kind === 'products') {
    return toPreview(PRODUCT_TEMPLATE, data.map((r) => PRODUCT_TEMPLATE.map((_, j) => r[j] ?? '')), (rec) => {
      if (!rec.name) return 'পণ্যের নাম আবশ্যক।';
      try {
        if (rec.purchase_price) toPaisa(rec.purchase_price);
        if (rec.selling_price) toPaisa(rec.selling_price);
        if (rec.opening_stock) toMilli(rec.opening_stock);
        if (rec.min_stock) toMilli(rec.min_stock);
      } catch { return 'দাম বা স্টকের সংখ্যা সঠিক নয়।'; }
      return null;
    });
  }
  if (kind === 'customers') {
    return toPreview(CUSTOMER_TEMPLATE, data.map((r) => CUSTOMER_TEMPLATE.map((_, j) => r[j] ?? '')), (rec) => {
      if (!rec.name) return 'কাস্টমারের নাম আবশ্যক।';
      try { if (rec.opening_due) toPaisa(rec.opening_due); } catch { return 'বকেয়ার পরিমাণ সঠিক নয়।'; }
      return null;
    });
  }
  return toPreview(SUPPLIER_TEMPLATE, data.map((r) => SUPPLIER_TEMPLATE.map((_, j) => r[j] ?? '')), (rec) => {
    if (!rec.name) return 'সরবরাহকারীর নাম আবশ্যক।';
    try { if (rec.opening_payable) toPaisa(rec.opening_payable); } catch { return 'দেনার পরিমাণ সঠিক নয়।'; }
    return null;
  });
}

function ensureMaster(db: Db, businessId: number, table: 'categories' | 'brands' | 'units', name: string): number | null {
  const n = name?.trim();
  if (!n) return null;
  const existing = db.prepare(`SELECT id FROM ${table} WHERE business_id = ? AND name = ?`).get(businessId, n) as { id: number } | undefined;
  if (existing) return existing.id;
  const cols = table === 'units' ? '(business_id, name, allow_fraction, created_at)' : table === 'categories' ? '(business_id, name, parent_id, created_at)' : '(business_id, name, created_at)';
  const vals = table === 'units' ? [businessId, n, 1, nowIso()] : table === 'categories' ? [businessId, n, null, nowIso()] : [businessId, n, nowIso()];
  const r = db.prepare(`INSERT INTO ${table} ${cols} VALUES (${vals.map(() => '?').join(',')})`).run(...vals);
  return Number(r.lastInsertRowid);
}

export function confirmImport(db: Db, ctx: Ctx, kind: 'products' | 'customers' | 'suppliers', rows: Record<string, string>[]): { imported: number; skipped: number } {
  requirePerm(ctx, 'import.run');
  if (!rows.length) throw new AppError('IMPORT_EMPTY');
  const now = nowIso();
  let imported = 0;
  let skipped = 0;
  const txn = db.transaction(() => {
    if (kind === 'products') {
      const ins = db.prepare(
        `INSERT INTO products (business_id, name, sku, barcode, category_id, brand_id, unit_id, purchase_price, selling_price, stock_milli, min_stock_milli, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?)`,
      );
      const mov = db.prepare(
        'INSERT INTO inventory_movements (business_id, product_id, type, qty_milli, prev_milli, new_milli, ref_type, ref_id, reason, occurred_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const layer = db.prepare('INSERT INTO cost_layers (business_id, product_id, purchase_id, qty_milli_remaining, unit_cost, created_at) VALUES (?, ?, NULL, ?, ?, ?)');
      for (const rec of rows) {
        try {
          const name = rec.name?.trim();
          if (!name) { skipped++; continue; }
          const cat = ensureMaster(db, ctx.businessId, 'categories', rec.category);
          const brand = ensureMaster(db, ctx.businessId, 'brands', rec.brand);
          const unit = ensureMaster(db, ctx.businessId, 'units', rec.unit);
          const pp = rec.purchase_price ? toPaisa(rec.purchase_price) : 0;
          const sp = rec.selling_price ? toPaisa(rec.selling_price) : 0;
          const minS = rec.min_stock ? toMilli(rec.min_stock) : 0;
          const openS = rec.opening_stock ? toMilli(rec.opening_stock) : 0;
          const r = ins.run(ctx.businessId, name, sanitizeText(rec.sku, 64), sanitizeText(rec.barcode, 64), cat, brand, unit, pp, sp, minS, now, now);
          const pid = Number(r.lastInsertRowid);
          if (openS > 0) {
            db.prepare('UPDATE products SET stock_milli = ? WHERE id = ?').run(openS, pid);
            mov.run(ctx.businessId, pid, 'OPENING', openS, 0, openS, 'IMPORT', null, 'ইমপোর্ট থেকে প্রারম্ভিক স্টক', now, ctx.userId);
            layer.run(ctx.businessId, pid, openS, pp, now);
          }
          imported++;
        } catch { skipped++; }
      }
    } else if (kind === 'customers') {
      const ins = db.prepare('INSERT INTO customers (business_id, name, phone, address, opening_due, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const led = db.prepare(
        'INSERT INTO customer_ledger (business_id, customer_id, occurred_at, ref_type, ref_id, description, debit, credit, balance, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const rec of rows) {
        try {
          const name = rec.name?.trim();
          if (!name) { skipped++; continue; }
          const due = rec.opening_due ? toPaisa(rec.opening_due) : 0;
          const r = ins.run(ctx.businessId, name, sanitizeText(rec.phone, 20), sanitizeText(rec.address, 500), due, 'active', now, now);
          const id = Number(r.lastInsertRowid);
          if (due > 0) led.run(ctx.businessId, id, now, 'OPENING', null, 'প্রারম্ভিক বকেয়া', due, 0, due, ctx.userId, now);
          imported++;
        } catch { skipped++; }
      }
    } else {
      const ins = db.prepare('INSERT INTO suppliers (business_id, name, phone, address, opening_payable, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const led = db.prepare(
        'INSERT INTO supplier_ledger (business_id, supplier_id, occurred_at, ref_type, ref_id, description, debit, credit, balance, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const rec of rows) {
        try {
          const name = rec.name?.trim();
          if (!name) { skipped++; continue; }
          const pay = rec.opening_payable ? toPaisa(rec.opening_payable) : 0;
          const r = ins.run(ctx.businessId, name, sanitizeText(rec.phone, 20), sanitizeText(rec.address, 500), pay, 'active', now, now);
          const id = Number(r.lastInsertRowid);
          if (pay > 0) led.run(ctx.businessId, id, now, 'OPENING', null, 'প্রারম্ভিক দেনা', 0, pay, pay, ctx.userId, now);
          imported++;
        } catch { skipped++; }
      }
    }
    audit(db, ctx, 'import.confirm', 'import', null, null, { kind, imported, skipped });
  });
  txn();
  return { imported, skipped };
}

// ---------- Export ----------

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(db: Db, ctx: Ctx, kind: string, from?: string, to?: string): { file: string } {
  const paths = getPaths();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(paths.exportDir, `merqo-${kind}-${stamp}.csv`);
  let headers: string[] = [];
  let rows: unknown[][] = [];
  const b = ctx.businessId;
  if (kind === 'products') {
    headers = ['নাম', 'SKU', 'বারকোড', 'ক্যাটাগরি', 'ব্র্যান্ড', 'একক', 'ক্রয়মূল্য', 'বিক্রয়মূল্য', 'স্টক'];
    const data = db.prepare(
      `SELECT p.name, p.sku, p.barcode, c.name AS cat, b.name AS brand, u.name AS unit, p.purchase_price, p.selling_price, p.stock_milli
       FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN units u ON u.id = p.unit_id
       WHERE p.business_id = ? ORDER BY p.name ASC`,
    ).all(b) as Record<string, unknown>[];
    rows = data.map((r) => [r.name, r.sku ?? '', r.barcode ?? '', r.cat ?? '', r.brand ?? '', r.unit ?? '', Number(r.purchase_price) / 100, Number(r.selling_price) / 100, Number(r.stock_milli) / 1000]);
  } else if (kind === 'sales') {
    headers = ['ইনভয়েস', 'তারিখ', 'কাস্টমার', 'মোট', 'পরিশোধ', 'বকেয়া', 'অবস্থা'];
    const data = db.prepare(
      `SELECT s.invoice_no, s.sold_at, c.name AS customer, s.total, s.paid, s.due, s.status FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ? ${from ? 'AND s.sold_at >= ?' : ''} ${to ? 'AND s.sold_at <= ?' : ''} ORDER BY s.id DESC LIMIT 20000`,
    ).all(b, ...(from ? [from] : []), ...(to ? [to] : [])) as Record<string, unknown>[];
    rows = data.map((r) => [r.invoice_no, r.sold_at, r.customer ?? 'ওয়াক-ইন', Number(r.total) / 100, Number(r.paid) / 100, Number(r.due) / 100, r.status]);
  } else if (kind === 'customers') {
    headers = ['নাম', 'মোবাইল', 'ঠিকানা', 'বকেয়া'];
    const data = db.prepare(
      `SELECT c.name, c.phone, c.address, COALESCE(SUM(l.debit - l.credit),0) AS due FROM customers c
       LEFT JOIN customer_ledger l ON l.customer_id = c.id WHERE c.business_id = ? GROUP BY c.id ORDER BY c.name ASC`,
    ).all(b) as Record<string, unknown>[];
    rows = data.map((r) => [r.name, r.phone ?? '', r.address ?? '', Number(r.due) / 100]);
  } else if (kind === 'suppliers') {
    headers = ['নাম', 'মোবাইল', 'ঠিকানা', 'দেনা'];
    const data = db.prepare(
      `SELECT s.name, s.phone, s.address, COALESCE(SUM(l.credit - l.debit),0) AS payable FROM suppliers s
       LEFT JOIN supplier_ledger l ON l.supplier_id = s.id WHERE s.business_id = ? GROUP BY s.id ORDER BY s.name ASC`,
    ).all(b) as Record<string, unknown>[];
    rows = data.map((r) => [r.name, r.phone ?? '', r.address ?? '', Number(r.payable) / 100]);
  } else {
    throw new AppError('DB_ERROR');
  }
  const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  fs.writeFileSync(file, csv, 'utf8');
  audit(db, ctx, 'export.csv', 'export', null, null, { kind, count: rows.length });
  return { file };
}

export async function exportExcel(db: Db, ctx: Ctx, kind: string, title: string, headers: string[], rows: unknown[][]): Promise<{ file: string }> {
  const paths = getPaths();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(paths.exportDir, `merqo-${kind}-${stamp}.xlsx`);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MERQO Retail Suite';
  const ws = wb.addWorksheet(title.slice(0, 31) || 'রিপোর্ট');
  ws.addRow([title]);
  ws.addRow([`তৈরির সময়: ${new Date().toLocaleString('bn-BD')}`]);
  ws.addRow([]);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r as ExcelJS.CellValue[]);
  ws.columns.forEach((c) => { c.width = 22; });
  await wb.xlsx.writeFile(file);
  audit(db, ctx, 'export.excel', 'export', null, null, { kind, count: rows.length });
  return { file };
}

export function downloadTemplate(kind: 'products' | 'customers' | 'suppliers'): { file: string } {
  const paths = getPaths();
  const map = { products: PRODUCT_TEMPLATE, customers: CUSTOMER_TEMPLATE, suppliers: SUPPLIER_TEMPLATE };
  const file = path.join(paths.exportDir, `merqo-template-${kind}.csv`);
  fs.writeFileSync(file, '\uFEFF' + map[kind].join(',') + '\n', 'utf8');
  return { file };
}
