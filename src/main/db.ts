import Database from 'better-sqlite3';
import fs from 'node:fs';
import { getPaths } from './paths';
import { logger } from './logger';
import { EXPENSE_CATEGORIES_SEED, UNITS_SEED } from '../shared/constants';

export type Db = Database.Database;

let db: Db | null = null;

export function getDb(): Db {
  if (!db) throw new Error('DB_ERROR');
  return db;
}

const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'base_schema',
    sql: `
    CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_name TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      business_type TEXT,
      logo_path TEXT,
      currency TEXT NOT NULL DEFAULT 'BDT',
      timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
      invoice_prefix TEXT NOT NULL DEFAULT 'MERQO',
      invoice_next_no INTEGER NOT NULL DEFAULT 1,
      footer TEXT,
      terms TEXT,
      tax_default_bp INTEGER NOT NULL DEFAULT 0,
      tax_mode TEXT NOT NULL DEFAULT 'none',
      negative_stock_allowed INTEGER NOT NULL DEFAULT 0,
      overpayment_policy TEXT NOT NULL DEFAULT 'block',
      digit_locale TEXT NOT NULL DEFAULT 'en',
      receipt_width TEXT NOT NULL DEFAULT '80mm',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, username)
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      role TEXT NOT NULL,
      permission_key TEXT NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 1,
      UNIQUE(business_id, role, permission_key)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES categories(id),
      created_at TEXT NOT NULL,
      UNIQUE(business_id, name)
    );

    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(business_id, name)
    );

    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      allow_fraction INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(business_id, name)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      email TEXT,
      opening_payable INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      sku TEXT,
      barcode TEXT,
      category_id INTEGER REFERENCES categories(id),
      brand_id INTEGER REFERENCES brands(id),
      unit_id INTEGER REFERENCES units(id),
      purchase_price INTEGER NOT NULL DEFAULT 0,
      selling_price INTEGER NOT NULL DEFAULT 0,
      wholesale_price INTEGER NOT NULL DEFAULT 0,
      min_selling_price INTEGER NOT NULL DEFAULT 0,
      stock_milli INTEGER NOT NULL DEFAULT 0,
      min_stock_milli INTEGER NOT NULL DEFAULT 0,
      max_stock_milli INTEGER NOT NULL DEFAULT 0,
      reorder_milli INTEGER NOT NULL DEFAULT 0,
      supplier_id INTEGER REFERENCES suppliers(id),
      image_path TEXT,
      tax_bp INTEGER NOT NULL DEFAULT 0,
      batch_tracked INTEGER NOT NULL DEFAULT 0,
      expiry_tracked INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(business_id, barcode) WHERE barcode IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(business_id, sku) WHERE sku IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(business_id, name);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(business_id, category_id);

    CREATE TABLE IF NOT EXISTS product_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_no TEXT,
      expiry_date TEXT,
      qty_milli INTEGER NOT NULL DEFAULT 0,
      unit_cost INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_batches_product ON product_batches(product_id, expiry_date);

    CREATE TABLE IF NOT EXISTS cost_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      purchase_id INTEGER,
      qty_milli_remaining INTEGER NOT NULL DEFAULT 0,
      unit_cost INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_layers_product ON cost_layers(business_id, product_id, id);

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      email TEXT,
      opening_due INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(business_id, phone);
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(business_id, name);

    CREATE TABLE IF NOT EXISTS financial_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      opening_balance INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, code)
    );

    CREATE TABLE IF NOT EXISTS financial_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
      direction TEXT NOT NULL,
      amount INTEGER NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id INTEGER,
      description TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fintxn_account ON financial_transactions(business_id, account_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_fintxn_ref ON financial_transactions(business_id, ref_type, ref_id);

    CREATE TABLE IF NOT EXISTS account_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      reference TEXT NOT NULL,
      from_account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
      to_account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
      amount INTEGER NOT NULL,
      notes TEXT,
      occurred_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(business_id, reference)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      invoice_no TEXT NOT NULL,
      customer_id INTEGER REFERENCES customers(id),
      employee_id INTEGER REFERENCES users(id),
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      due INTEGER NOT NULL DEFAULT 0,
      change_amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      held_name TEXT,
      payment_status TEXT NOT NULL DEFAULT 'PAID',
      notes TEXT,
      sold_at TEXT NOT NULL,
      voided_at TEXT,
      void_reason TEXT,
      voided_by INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(business_id, invoice_no)
    );
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(business_id, sold_at, status);
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(business_id, customer_id, sold_at);

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_id INTEGER REFERENCES product_batches(id),
      qty_milli INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      discount INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0,
      line_total INTEGER NOT NULL,
      unit_cost INTEGER NOT NULL DEFAULT 0,
      returned_milli INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_saleitems_sale ON sale_items(sale_id);

    CREATE TABLE IF NOT EXISTS sale_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id),
      account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
      method TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reference TEXT,
      paid_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_salepay_sale ON sale_payments(sale_id);

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      reference TEXT NOT NULL,
      supplier_id INTEGER REFERENCES suppliers(id),
      supplier_invoice TEXT,
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      due INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      notes TEXT,
      purchased_at TEXT NOT NULL,
      voided_at TEXT,
      void_reason TEXT,
      voided_by INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(business_id, reference)
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(business_id, purchased_at, status);
    CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(business_id, supplier_id, purchased_at);

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      qty_milli INTEGER NOT NULL,
      unit_cost INTEGER NOT NULL,
      discount INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0,
      line_total INTEGER NOT NULL,
      returned_milli INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_purchaseitems_purchase ON purchase_items(purchase_id);

    CREATE TABLE IF NOT EXISTS purchase_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id),
      account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
      method TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reference TEXT,
      paid_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sale_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      reference TEXT NOT NULL,
      sale_id INTEGER NOT NULL REFERENCES sales(id),
      customer_id INTEGER REFERENCES customers(id),
      total_refund INTEGER NOT NULL DEFAULT 0,
      account_id INTEGER REFERENCES financial_accounts(id),
      reason TEXT,
      returned_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(business_id, reference)
    );

    CREATE TABLE IF NOT EXISTS sale_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_return_id INTEGER NOT NULL REFERENCES sale_returns(id),
      sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      qty_milli INTEGER NOT NULL,
      refund INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      reference TEXT NOT NULL,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id),
      supplier_id INTEGER REFERENCES suppliers(id),
      total_credit INTEGER NOT NULL DEFAULT 0,
      account_id INTEGER REFERENCES financial_accounts(id),
      reason TEXT,
      returned_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(business_id, reference)
    );

    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_return_id INTEGER NOT NULL REFERENCES purchase_returns(id),
      purchase_item_id INTEGER NOT NULL REFERENCES purchase_items(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      qty_milli INTEGER NOT NULL,
      credit INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      type TEXT NOT NULL,
      qty_milli INTEGER NOT NULL,
      prev_milli INTEGER NOT NULL,
      new_milli INTEGER NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id INTEGER,
      reason TEXT,
      occurred_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_movements_product ON inventory_movements(business_id, product_id, id);
    CREATE INDEX IF NOT EXISTS idx_movements_date ON inventory_movements(business_id, occurred_at);

    CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(business_id, name)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      category_id INTEGER REFERENCES expense_categories(id),
      amount INTEGER NOT NULL,
      account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
      description TEXT,
      reference TEXT,
      occurred_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(business_id, occurred_at);

    CREATE TABLE IF NOT EXISTS customer_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      occurred_at TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id INTEGER,
      description TEXT NOT NULL,
      debit INTEGER NOT NULL DEFAULT 0,
      credit INTEGER NOT NULL DEFAULT 0,
      balance INTEGER NOT NULL DEFAULT 0,
      method TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cledger_customer ON customer_ledger(business_id, customer_id, id);

    CREATE TABLE IF NOT EXISTS supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      occurred_at TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id INTEGER,
      description TEXT NOT NULL,
      debit INTEGER NOT NULL DEFAULT 0,
      credit INTEGER NOT NULL DEFAULT 0,
      balance INTEGER NOT NULL DEFAULT 0,
      method TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sledger_supplier ON supplier_ledger(business_id, supplier_id, id);

    CREATE TABLE IF NOT EXISTS customer_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      reference TEXT NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
      method TEXT NOT NULL,
      amount INTEGER NOT NULL,
      notes TEXT,
      paid_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(business_id, reference)
    );

    CREATE TABLE IF NOT EXISTS supplier_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      reference TEXT NOT NULL,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
      method TEXT NOT NULL,
      amount INTEGER NOT NULL,
      notes TEXT,
      paid_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(business_id, reference)
    );

    CREATE TABLE IF NOT EXISTS mfs_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      reference TEXT NOT NULL,
      provider TEXT NOT NULL,
      txn_type TEXT NOT NULL,
      customer_mobile TEXT,
      provider_txn_id TEXT,
      amount INTEGER NOT NULL,
      charge INTEGER NOT NULL DEFAULT 0,
      commission INTEGER NOT NULL DEFAULT 0,
      cash_account_id INTEGER REFERENCES financial_accounts(id),
      provider_account_id INTEGER REFERENCES financial_accounts(id),
      notes TEXT,
      occurred_at TEXT NOT NULL,
      operator_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(business_id, reference)
    );
    CREATE INDEX IF NOT EXISTS idx_mfs_date ON mfs_transactions(business_id, provider, occurred_at);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      user_id INTEGER REFERENCES users(id),
      occurred_at TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(business_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(business_id, entity, entity_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      dedupe_key TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(business_id, created_at);

    CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, key)
    );

    CREATE TABLE IF NOT EXISTS stock_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id),
      reference TEXT NOT NULL,
      notes TEXT,
      counted_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(business_id, reference)
    );

    CREATE TABLE IF NOT EXISTS stock_count_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_count_id INTEGER NOT NULL REFERENCES stock_counts(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      system_milli INTEGER NOT NULL,
      counted_milli INTEGER NOT NULL,
      diff_milli INTEGER NOT NULL
    );
    `,
  },
];

export function openDatabase(dbFile?: string): Db {
  const paths = getPaths();
  const file = dbFile ?? paths.dbFile;
  const database = new Database(file);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('synchronous = NORMAL');
  database.pragma('busy_timeout = 5000');
  db = database;
  runMigrations(database);
  return database;
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* noop */
    }
    db = null;
  }
}

/** Open an isolated DB handle (used by tests). Does not replace the global handle. */
export function openIsolatedDatabase(file: string): Db {
  const database = new Database(file);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('synchronous = NORMAL');
  runMigrations(database);
  return database;
}

function runMigrations(database: Db): void {
  database.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set(
    (database.prepare('SELECT version FROM _migrations').all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    logger.info('db', `Applying migration v${m.version} ${m.name}`);
    const txn = database.transaction(() => {
      database.exec(m.sql);
      database.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
    });
    txn();
  }
}

/** Seed per-business master data: accounts, expense categories, units. Idempotent. */
export function seedBusinessDefaults(database: Db, businessId: number, opening?: Record<string, number>): void {
  const now = new Date().toISOString();
  const accounts: { code: string; name: string; type: string }[] = [
    { code: 'CASH', name: 'হাতে নগদ', type: 'cash' },
    { code: 'BANK', name: 'ব্যাংক', type: 'bank' },
    { code: 'BKASH', name: 'বিকাশ', type: 'mfs' },
    { code: 'NAGAD', name: 'নগদ', type: 'mfs' },
    { code: 'ROCKET', name: 'রকেট', type: 'mfs' },
    { code: 'UPAY', name: 'উপায়', type: 'mfs' },
    { code: 'CARD', name: 'কার্ড', type: 'card' },
    { code: 'OTHER', name: 'অন্যান্য', type: 'other' },
  ];
  const insertAcct = database.prepare(
    'INSERT OR IGNORE INTO financial_accounts (business_id, code, name, type, opening_balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const updateOpening = database.prepare('UPDATE financial_accounts SET opening_balance = ? WHERE business_id = ? AND code = ?');
  for (const a of accounts) {
    insertAcct.run(businessId, a.code, a.name, a.type, 0, now, now);
    if (opening && typeof opening[a.code] === 'number' && opening[a.code] > 0) {
      updateOpening.run(opening[a.code], businessId, a.code);
    }
  }
  const insertCat = database.prepare('INSERT OR IGNORE INTO expense_categories (business_id, name, created_at) VALUES (?, ?, ?)');
  for (const c of EXPENSE_CATEGORIES_SEED) insertCat.run(businessId, c, now);
  const insertUnit = database.prepare('INSERT OR IGNORE INTO units (business_id, name, allow_fraction, created_at) VALUES (?, ?, 1, ?)');
  for (const u of UNITS_SEED) insertUnit.run(businessId, u, now);
  const settings = database.prepare('INSERT OR IGNORE INTO settings (business_id, key, value, updated_at) VALUES (?, ?, ?, ?)');
  settings.run(businessId, 'backup_reminder_days', '7', now);
  settings.run(businessId, 'auto_backup_on_exit', '0', now);
  settings.run(businessId, 'low_stock_notify', '1', now);
  settings.run(businessId, 'due_notify', '1', now);
  settings.run(businessId, 'expiry_notify_days', '30', now);
}

export function integrityCheck(database?: Db): { ok: boolean; detail: string } {
  const d = database ?? getDb();
  try {
    const rows = d.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    const ok = rows.length === 1 && rows[0].integrity_check === 'ok';
    return { ok, detail: ok ? 'ok' : JSON.stringify(rows).slice(0, 500) };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 500) };
  }
}

/** Verify a backup file is a readable SQLite DB with expected schema. */
export function verifyBackupFile(file: string): { ok: boolean; detail: string } {
  try {
    if (!fs.existsSync(file)) return { ok: false, detail: 'missing' };
    const st = fs.statSync(file);
    if (st.size < 4096) return { ok: false, detail: 'too_small' };
    const probe = new Database(file, { readonly: true });
    try {
      const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const names = new Set(tables.map((t) => t.name));
      const required = ['businesses', 'products', 'sales', 'purchases', 'financial_accounts', '_migrations'];
      for (const r of required) {
        if (!names.has(r)) return { ok: false, detail: `missing_table:${r}` };
      }
      return { ok: true, detail: 'ok' };
    } finally {
      probe.close();
    }
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 300) };
  }
}
