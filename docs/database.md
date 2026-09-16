# MERQO — Database Schema (SQLite)

File: `%AppData%/MERQO Retail Suite/merqo.db`, `journal_mode=WAL`, `foreign_keys=ON`.

## Migrations

`src/main/db.ts` → `MIGRATIONS[]`, tracked in `_migrations(version, name, applied_at)`.
v1 creates the full schema below. Future versions must only **add** migrations —
never edit applied ones; test upgrade on a copy of a real database.

## Entity groups

**Workspace**: `businesses`, `users`, `role_permissions`, `settings`

**Catalog**: `categories` (self-parent), `brands`, `units`, `products`,
`product_batches`, `cost_layers` (FIFO)

**Parties**: `customers`, `suppliers`, `customer_ledger`, `supplier_ledger`,
`customer_payments`, `supplier_payments`

**Sales**: `sales`, `sale_items`, `sale_payments`, `sale_returns`, `sale_return_items`

**Purchases**: `purchases`, `purchase_items`, `purchase_payments`,
`purchase_returns`, `purchase_return_items`

**Inventory**: `inventory_movements`, `stock_counts`, `stock_count_items`

**Money**: `financial_accounts`, `financial_transactions`, `account_transfers`,
`expenses`, `expense_categories`, `mfs_transactions`

**System**: `audit_logs`, `notifications`, `backups`

## Key constraints

- `products`: unique `(business_id, barcode)` and `(business_id, sku)` partial indexes (NULLs allowed, duplicates blocked) → Bengali errors, never raw SQL.
- `sales`: unique `(business_id, invoice_no)`; invoice numbers from `businesses.invoice_next_no` inside the sale transaction.
- References (`PO-…`, `SR-…`, `CR-…`, `SP-…`, `TR-…`, `MFS-…`) unique per business, dated, sequential.
- Money columns `INTEGER` (paisa), qty columns `INTEGER` (milli).
- Timestamps: UTC ISO-8601 strings (`sold_at`, `occurred_at`, …); business-day
  filtering converts local ranges to UTC bounds (`src/shared/dates.ts`).

## Seeds (per business, idempotent)

`seedBusinessDefaults()`: 8 financial accounts (CASH/BANK/BKASH/NAGAD/ROCKET/UPAY/CARD/OTHER),
9 expense categories, 10 units, default settings keys.

## Integrity

- `integrityCheck()` runs `PRAGMA integrity_check`.
- `verifyBackupFile()` validates a restore candidate (size, required tables) before use.
- Reconciliation identities are asserted in integration tests (stock == Σ movements;
  ledger last-balance == recomputed sum; account list == recomputed balances).
