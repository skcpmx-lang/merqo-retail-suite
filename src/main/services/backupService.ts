import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db';
import { closeDatabase, openDatabase, verifyBackupFile, integrityCheck } from '../db';
import { AppError, Ctx, audit, requirePerm } from './_helpers';
import { getPaths } from '../paths';
import { logger } from '../logger';
import { nowIso } from '../../shared/dates';

export function listBackups(db: Db, ctx: Ctx): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM backups WHERE business_id = ? ORDER BY id DESC LIMIT 100').all(ctx.businessId) as Record<string, unknown>[];
}

export function createBackup(db: Db, ctx: Ctx, note?: string): { file: string; size: number } {
  requirePerm(ctx, 'backup.create');
  const paths = getPaths();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(paths.backupDir, `merqo-backup-${stamp}.db`);
  try {
    // SQLite backup API via VACUUM INTO (atomic snapshot, works on live DB)
    db.prepare('VACUUM INTO ?').run(file);
  } catch (e) {
    logger.error('backup', 'VACUUM INTO failed', String(e));
    throw new AppError('DB_ERROR');
  }
  const st = fs.statSync(file);
  const v = verifyBackupFile(file);
  db.prepare('INSERT INTO backups (business_id, file_path, size_bytes, note, verified, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    ctx.businessId, file, st.size, note?.trim() || null, v.ok ? 1 : 0, nowIso(),
  );
  audit(db, ctx, 'backup.create', 'backup', null, null, { file, size: st.size });
  return { file, size: st.size };
}

/**
 * Restore flow: validate -> safety backup -> replace -> verify -> reopen.
 * NOTE: caller (main process) must close all windows flows after restore; renderer reloads state.
 */
export function restoreBackup(db: Db, ctx: Ctx, backupFile: string): { ok: boolean } {
  requirePerm(ctx, 'backup.restore');
  const v = verifyBackupFile(backupFile);
  if (!v.ok) throw new AppError('BACKUP_INVALID');
  const paths = getPaths();
  // Safety backup of current DB first
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safety = path.join(paths.backupDir, `merqo-pre-restore-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(safety);
  audit(db, ctx, 'backup.pre_restore', 'backup', null, null, { safety });
  // Close, replace, reopen
  closeDatabase();
  try {
    fs.copyFileSync(backupFile, paths.dbFile);
    // Remove WAL sidecars so the restored image opens cleanly
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const f = paths.dbFile + suffix;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  } catch (e) {
    logger.error('backup', 'restore copy failed', String(e));
    openDatabase();
    throw new AppError('DB_ERROR');
  }
  const reopened = openDatabase();
  const check = integrityCheck(reopened);
  if (!check.ok) {
    logger.error('backup', 'restored DB failed integrity check', check.detail);
    throw new AppError('BACKUP_INVALID');
  }
  // Fix: insert restore record properly
  try {
    const st = fs.statSync(paths.dbFile);
    reopened.prepare('INSERT INTO backups (business_id, file_path, size_bytes, note, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
      ctx.businessId, backupFile, st.size, 'পুনরুদ্ধার করা হয়েছে', nowIso(),
    );
  } catch {
    /* best-effort */
  }
  return { ok: true };
}

export function systemHealth(db: Db, ctx: Ctx): Record<string, unknown> {
  const paths = getPaths();
  const check = integrityCheck(db);
  const last = db.prepare('SELECT created_at, file_path FROM backups WHERE business_id = ? ORDER BY id DESC LIMIT 1').get(ctx.businessId) as
    | { created_at: string; file_path: string } | undefined;
  let dbSize = 0;
  try {
    dbSize = fs.statSync(paths.dbFile).size;
  } catch { /* noop */ }
  const counts: Record<string, number> = {};
  for (const t of ['products', 'sales', 'purchases', 'customers', 'suppliers']) {
    try {
      counts[t] = (db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE business_id = ?`).get(ctx.businessId) as { c: number }).c;
    } catch { counts[t] = 0; }
  }
  return {
    dbOk: check.ok, dbDetail: check.ok ? null : check.detail,
    dbSize, dbFile: paths.dbFile, backupDir: paths.backupDir,
    lastBackup: last ?? null, counts,
  };
}
