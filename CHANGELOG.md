# Changelog

All notable changes to MERQO Retail Suite. Format follows Keep a Changelog; versions are SemVer.

## [1.0.0] - 2026-09-16

### Added
- First-run setup wizard (business, opening balances, invoice, admin security)
- POS terminal: barcode scanning, cart, discounts, multi-payment, hold/restore, due/change
- Sales invoices (A4 / 80mm / 58mm / PDF), reprint, void with reversal, sale returns
- Products: SKU/barcode/QR, categories/brands/units, FIFO costing, batches/expiry
- Inventory: movement ledger, adjustments, damage/loss, stock count, low/out/expiry alerts
- Purchases with partial payment, supplier ledger/payments/returns
- Customers with running-balance ledger, statements, payment receipts
- Financial accounts, transfers, categorized expenses
- Manual MFS agent ledger (bKash/Nagad/Rocket/Upay): cash in/out, charge, commission
- Reports: sales, purchase, inventory, financial, FIFO profit, receivables/payables, agent
- Employees: 7 roles, granular permissions, audit log, session security + auto-lock
- Notifications center, system health, backup/restore, CSV import/export, XLSX export
- Windows NSIS installer + portable build configuration

### Security
- scrypt password hashing, timing-safe compare, 256-bit session tokens
- Server-side permission checks on every IPC route; runtime remote-content block

### Notes
- Fresh installs ship with no demo data. SQLite schema v1 (no migration needed).
