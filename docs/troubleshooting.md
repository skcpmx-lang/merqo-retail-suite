# MERQO — Troubleshooting

## App won't start

1. Check `<userData>/logs/merqo.log` tail for the failure scope.
2. If the DB is locked: ensure only one instance runs; delete stale
   `merqo.db-wal`/`-shm` only while the app is **closed**.
3. If the DB is corrupt: restore the latest verified backup on a copy first.

## Database errors during a sale

The transaction rolled back — nothing was half-saved. Retry; if it persists,
export a backup and contact support with the log excerpt.

## Printer not found

- Reconnect / power on → Settings → Printer → Refresh → Test print.
- Use Preview or PDF as fallback; the sale is already saved.

## Barcode scanner types but nothing happens

- Focus must be in the barcode field (it auto-focuses on the POS page).
- Scanner must send Enter after the code (standard keyboard-emulation mode).
- Verify the code exists: Products → search.

## Wrong totals / balances

Balances are derived, not stored: re-check via Reports (receivables,
payables, account balances) and the party ledger screens. If a screen and a
report disagree, that is a bug — capture steps + backup and report it.

## Forgot admin password

There is no backdoor. Restore access by reinstalling ownership: stop the app,
take a file copy of `merqo.db`, and use a documented owner-reset procedure
from support (verifies physical access to the machine).

## Performance

- Keep reports within date ranges; grids paginate at 50–100 rows.
- Vacuum occasionally: take a backup (which compacts via `VACUUM INTO`)
  and restore it during off-hours if the DB grows very large.
