# MERQO — Roles & Permissions

Roles: Owner, Admin, Manager, Cashier, Sales Staff, Inventory Staff, Accountant
(`src/shared/constants.ts` → `DEFAULT_ROLE_PERMISSIONS`).

## Highlights (defaults)

- **Cashier**: sell, reprint, create customer, view sales reports. Cannot see
  costs, change prices, void invoices, manage users, or restore backups.
- **Manager**: full daily operations; no user/permission management, no restore.
- **Accountant**: payments, expenses, transfers, MFS, financial reports, audit view.
- **Inventory**: products, stock ops, purchases, inventory reports.
- **Owner/Admin**: everything (Owner is locked to full access).

## Enforcement

- Server-side: every IPC route calls `requirePerm`; denial returns
  `NO_PERMISSION` → Bengali message.
- UI-side: buttons/menus hidden or disabled via `can()` from session.
- Changes: Employees → Roles matrix (audited). Sessions pick up new
  permissions on next call (resolved per request from DB).

## Sessions

- scrypt-hashed passwords, timing-safe compare, random 256-bit tokens.
- 12h absolute session expiry; 15-minute inactivity auto-lock in UI.
- Password change in Settings → Security; user CRUD in Employees.
