/** Shared domain types between main and renderer. Money = integer paisa, Qty = integer milli-units. */

export interface Business {
  id: number;
  name: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  business_type: string | null;
  logo_path: string | null;
  currency: string;
  timezone: string;
  invoice_prefix: string;
  footer: string | null;
  terms: string | null;
  tax_default_bp: number;
  tax_mode: 'none' | 'item' | 'invoice';
  negative_stock_allowed: number;
  overpayment_policy: 'block' | 'advance';
  digit_locale: 'en' | 'bn';
  receipt_width: '58mm' | '80mm';
  created_at: string;
  updated_at: string;
}

export interface UserSafe {
  id: number;
  name: string;
  username: string;
  phone: string | null;
  role: string;
  active: number;
  last_login_at: string | null;
  created_at: string;
}

export interface Category { id: number; name: string; parent_id: number | null; created_at: string }
export interface Brand { id: number; name: string; created_at: string }
export interface Unit { id: number; name: string; allow_fraction: number; created_at: string }

export interface Product {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  category_id: number | null;
  brand_id: number | null;
  unit_id: number | null;
  purchase_price: number;
  selling_price: number;
  wholesale_price: number;
  min_selling_price: number;
  stock_milli: number;
  min_stock_milli: number;
  max_stock_milli: number;
  reorder_milli: number;
  supplier_id: number | null;
  image_path: string | null;
  tax_bp: number;
  batch_tracked: number;
  expiry_tracked: number;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
  updated_at: string;
  category_name?: string | null;
  brand_name?: string | null;
  unit_name?: string | null;
}

export interface Customer {
  id: number; name: string; phone: string | null; address: string | null;
  email: string | null; opening_due: number; notes: string | null;
  status: 'active' | 'inactive'; created_at: string;
  current_due?: number; total_purchases?: number; total_payments?: number;
}

export interface Supplier {
  id: number; name: string; phone: string | null; address: string | null;
  email: string | null; opening_payable: number; notes: string | null;
  status: 'active' | 'inactive'; created_at: string;
  current_payable?: number; total_purchases?: number; total_payments?: number;
}

export interface FinancialAccount {
  id: number; code: string; name: string; type: string;
  opening_balance: number; active: number; created_at: string;
  current_balance?: number;
}

export interface Sale {
  id: number; invoice_no: string; customer_id: number | null;
  subtotal: number; discount: number; tax: number; total: number;
  paid: number; due: number; change_amount: number;
  status: 'COMPLETED' | 'HELD' | 'VOID';
  held_name: string | null; payment_status: 'PAID' | 'PARTIAL' | 'DUE';
  notes: string | null; sold_at: string; created_by: number | null;
  customer_name?: string | null; employee_name?: string | null;
}

export interface Purchase {
  id: number; reference: string; supplier_id: number | null;
  supplier_invoice: string | null;
  subtotal: number; discount: number; tax: number; total: number;
  paid: number; due: number; status: 'COMPLETED' | 'VOID';
  notes: string | null; purchased_at: string; created_by: number | null;
  supplier_name?: string | null;
}

export interface LedgerEntry {
  id: number; occurred_at: string; ref_type: string; ref_id: number | null;
  description: string; debit: number; credit: number; balance: number; method: string | null;
}

export interface AuditEntry {
  id: number; user_id: number | null; user_name?: string | null;
  occurred_at: string; action: string; entity: string;
  entity_id: number | null; old_value: string | null; new_value: string | null; reason: string | null;
}

export interface NotificationRow {
  id: number; type: string; priority: 'info' | 'warning' | 'critical';
  title: string; message: string; read_at: string | null; created_at: string;
}

export interface Paged<T> { rows: T[]; total: number; page: number; pageSize: number }

export interface Session {
  token: string;
  user: UserSafe;
  permissions: string[];
  business: Business | null;
}
