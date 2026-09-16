# MERQO Retail Suite

**MERQO Retail Suite — A production-grade Windows desktop business management system for grocery stores, super shops, mini marts, general stores, and modern retail businesses.**

Offline-first • বাংলা • Light mode • Windows desktop (Electron + React + SQLite)

---

## Features

- **POS & Sales** — keyboard-first terminal, USB/Bluetooth barcode scanners, hold/restore, partial payments, due/change, voids with reversal, sale returns
- **Purchase & Suppliers** — GRN-style purchase, supplier payables, payments, purchase returns, batch/expiry capture
- **Products & Inventory** — SKU/barcode/QR, categories/brands/units, FIFO costing, stock movement ledger, adjustments, damage/loss, stock count, low/out/expiry alerts
- **Customers & Receivables** — profiles, running-balance ledgers, statements, payment receipts
- **Accounts & Expenses** — cash/bank/MFS/card accounts, transfers, categorized expenses
- **Agent Banking (MFS)** — manual bKash/Nagad/Rocket/Upay ledger: cash in/out, charges, commission (no fake live integration)
- **Reports** — sales, purchase, inventory, financial, profit (FIFO), receivables/payables, agent summaries; print/PDF/Excel
- **Invoices & Printing** — A4, 80mm/58mm thermal, PDF; preview before print; embedded Bengali font
- **Employees & Audit** — 7 roles, granular permissions, session security, full audit log
- **Backup/Restore/Import/Export** — atomic `VACUUM INTO` backups, validated restore with safety copy, CSV import with preview, CSV/XLSX export
- **Notifications & Health** — low stock, dues, expiry, backup reminders; system health page

## Architecture

```
src/main/      Electron main: windows, IPC router, print/PDF, backup
src/main/services/  Domain logic (sales, purchase, inventory, ledger, …)
src/main/db.ts      SQLite connection + versioned migrations + seeds
src/preload/        Secure context-bridge (no Node in UI)
src/shared/         Money (paisa), qty (milli), dates, constants, Bengali copy
src/renderer/       React UI: design system, 12 modules, print documents
tests/              Vitest unit + full-scenario integration
docs/               Architecture, schema, rules, finance, costing, ops guides
installer/          Icons, NSIS license
```

Key invariants: integer paisa money, integer milli quantities, FIFO COGS,
derived balances (never stored), atomic business transactions, transaction-first printing.
See `docs/architecture.md` and `docs/business-rules.md`.

## Requirements

- Windows 10/11 x64 (target). Build machine: Windows with Node 20+.
- Node 20+ for development.

## Installation (users)

Run `MERQO Retail Suite-Setup-<version>.exe` → follow the installer →
launch from Start Menu/Desktop → complete the 5-step setup wizard.

## Development

```bash
npm install
npm run rebuild        # native modules for Electron (build machine)
npm run dev            # Vite renderer + tsc main (watch)
npm run electron       # launch shell (separate terminal)
```

Useful scripts: `npm test` (vitest), `npm run lint` (tsc),
`npm run build` (renderer + main), `npm run dist` (Windows NSIS + portable),
`npm run dist:dir` (unpacked folder for inspection).

## Database

SQLite at `%AppData%/MERQO Retail Suite/merqo.db` (WAL, FK enforced).
Migrations in `src/main/db.ts`; seeds per business (accounts, categories,
units, settings). Fresh installs contain **zero** demo data.

## Build & release

Releases are built on Windows CI (`.github/workflows/release.yml`):
`npm ci → npm run rebuild → npm run dist`. See `docs/release-process.md`
for the pre-release gate and `CHANGELOG.md` for history.

## Printing

A4 + 80/58mm thermal + PDF, all offline with embedded Bengali fonts.
See `docs/printer-setup.md`.

## Backup / restore / import / export

See `docs/backup-restore.md` and `docs/import-format.md`.

## Security

scrypt passwords, per-request permission checks, 15-min auto-lock,
validated imports, parameterized queries, no remote content at runtime
(enforced by a `webRequest` guard).

## License

Proprietary — see `LICENSE`. Third-party components: `THIRD_PARTY_LICENSES.md`.
