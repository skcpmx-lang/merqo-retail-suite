# MERQO — Backup & Restore

## Backup

- Settings → Backup → **এখনই ব্যাকআপ নিন**.
- Snapshot is taken with `VACUUM INTO` (atomic, safe on a live DB).
- Files: `<userData>/backups/merqo-backup-<timestamp>.db`, verified after write
  (size + required tables) and recorded in `backups`.
- Configurable reminder if no backup for N days (default 7); optional
  on-exit reminder flag.

## Restore

1. Settings → Backup → choose a `.db` file.
2. MERQO validates the file, explains consequences, and asks for confirmation.
3. A **pre-restore safety backup** of the current DB is taken automatically.
4. The database is replaced (WAL sidecars cleared), reopened, and
   `PRAGMA integrity_check` verified. The app reloads.

Never replace the database file manually while the app is running.

## Recovery

- Crash during a sale/purchase: SQLite transactions roll back automatically;
  no half-completed business records.
- Failed import: row-level validation + preview; only valid rows import,
  inside one transaction.
- Logs at `<userData>/logs/merqo.log` help diagnose startup/DB/printer issues.
