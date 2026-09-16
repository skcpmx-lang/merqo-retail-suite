import crypto from 'node:crypto';
import type { Db } from '../db';
import { AppError, Ctx, audit, requirePerm, paginate } from './_helpers';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, Role } from '../../shared/constants';
import { nowIso } from '../../shared/dates';
import { toSafeUser } from './authService';
import type { Paged, UserSafe } from '../../shared/types';

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function listUsers(db: Db, ctx: Ctx, opts: { page?: number; pageSize?: number }): Paged<UserSafe> {
  requirePerm(ctx, 'user.manage');
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const total = (db.prepare('SELECT COUNT(*) AS c FROM users WHERE business_id = ?').get(ctx.businessId) as { c: number }).c;
  const rows = (db.prepare('SELECT * FROM users WHERE business_id = ? ORDER BY id ASC LIMIT ? OFFSET ?').all(ctx.businessId, limit, offset) as Record<string, unknown>[]).map(toSafeUser);
  return { rows, total, page, pageSize };
}

export function createUser(db: Db, ctx: Ctx, input: { name: string; username: string; password: string; phone?: string | null; role: string }): number {
  requirePerm(ctx, 'user.manage');
  const name = input.name?.trim();
  const username = input.username?.trim().toLowerCase();
  if (!name || !username) throw new AppError('REQUIRED');
  if (!input.password || input.password.length < 6) throw new AppError('WEAK_PASSWORD');
  if (!(input.role in DEFAULT_ROLE_PERMISSIONS)) throw new AppError('DB_ERROR');
  const existing = db.prepare('SELECT id FROM users WHERE business_id = ? AND username = ?').get(ctx.businessId, username);
  if (existing) throw new AppError('USERNAME_DUPLICATE');
  const salt = crypto.randomBytes(16).toString('hex');
  const r = db.prepare(
    'INSERT INTO users (business_id, name, username, phone, role, password_hash, password_salt, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run(ctx.businessId, name, username, input.phone?.trim() || null, input.role, hashPassword(input.password, salt), salt, nowIso(), nowIso());
  const id = Number(r.lastInsertRowid);
  audit(db, ctx, 'user.create', 'user', id, null, { name, username, role: input.role });
  return id;
}

export function updateUser(db: Db, ctx: Ctx, id: number, input: { name?: string; phone?: string | null; role?: string; active?: boolean; password?: string }): void {
  requirePerm(ctx, 'user.manage');
  const old = db.prepare('SELECT * FROM users WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as Record<string, unknown> | undefined;
  if (!old) throw new AppError('USER_NOT_FOUND');
  if (input.role && !(input.role in DEFAULT_ROLE_PERMISSIONS)) throw new AppError('DB_ERROR');
  if (id === ctx.userId && input.active === false) throw new AppError('CANNOT_DELETE_SELF');
  // Prevent deactivating the last active owner/admin
  if (input.active === false) {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE business_id = ? AND active = 1 AND role IN ('owner','admin') AND id != ?").get(ctx.businessId, id) as { c: number };
    if ((old.role === 'owner' || old.role === 'admin') && admins.c === 0) throw new AppError('CANNOT_DELETE_LAST_ADMIN');
  }
  const txn = db.transaction(() => {
    db.prepare('UPDATE users SET name = COALESCE(?, name), phone = ?, role = COALESCE(?, role), active = COALESCE(?, active), updated_at = ? WHERE id = ?').run(
      input.name?.trim() || null,
      input.phone !== undefined ? input.phone?.trim() || null : old.phone,
      input.role ?? null,
      input.active === undefined ? null : input.active ? 1 : 0,
      nowIso(), id,
    );
    if (input.password) {
      if (input.password.length < 6) throw new AppError('WEAK_PASSWORD');
      const salt = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hashPassword(input.password, salt), salt, id);
    }
    audit(db, ctx, 'user.update', 'user', id, { role: old.role, active: old.active }, { role: input.role ?? old.role, active: input.active ?? old.active });
  });
  txn();
}

export function deleteUser(db: Db, ctx: Ctx, id: number): void {
  requirePerm(ctx, 'user.manage');
  if (id === ctx.userId) throw new AppError('CANNOT_DELETE_SELF');
  const old = db.prepare('SELECT * FROM users WHERE id = ? AND business_id = ?').get(id, ctx.businessId) as Record<string, unknown> | undefined;
  if (!old) throw new AppError('USER_NOT_FOUND');
  if (old.role === 'owner' || old.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE business_id = ? AND active = 1 AND role IN ('owner','admin') AND id != ?").get(ctx.businessId, id) as { c: number };
    if (admins.c === 0) throw new AppError('CANNOT_DELETE_LAST_ADMIN');
  }
  const sales = db.prepare('SELECT COUNT(*) AS c FROM sales WHERE created_by = ? OR employee_id = ?').get(id, id) as { c: number };
  if (sales.c > 0) {
    // Archive instead of delete when history exists
    db.prepare('UPDATE users SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), id);
    audit(db, ctx, 'user.deactivate', 'user', id);
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(db, ctx, 'user.delete', 'user', id);
}

export function getRolePermissions(db: Db, ctx: Ctx): Record<string, string[]> {
  requirePerm(ctx, 'permission.manage');
  const out: Record<string, string[]> = {};
  for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as Role[]) {
    const rows = db.prepare('SELECT permission_key FROM role_permissions WHERE business_id = ? AND role = ? AND allowed = 1').all(ctx.businessId, role) as {
      permission_key: string;
    }[];
    out[role] = rows.length ? rows.map((r) => r.permission_key) : [...DEFAULT_ROLE_PERMISSIONS[role]];
  }
  return out;
}

export function setRolePermissions(db: Db, ctx: Ctx, role: string, permissions: string[]): void {
  requirePerm(ctx, 'permission.manage');
  if (!(role in DEFAULT_ROLE_PERMISSIONS)) throw new AppError('DB_ERROR');
  if (role === 'owner' && permissions.length !== PERMISSIONS.length) throw new AppError('DB_ERROR'); // owner always full
  const valid = new Set(PERMISSIONS as readonly string[]);
  for (const p of permissions) {
    if (!valid.has(p)) throw new AppError('DB_ERROR');
  }
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE business_id = ? AND role = ?').run(ctx.businessId, role);
    const ins = db.prepare('INSERT INTO role_permissions (business_id, role, permission_key, allowed) VALUES (?, ?, ?, 1)');
    for (const p of permissions) ins.run(ctx.businessId, role, p);
    audit(db, ctx, 'permission.update', 'role', null, { role }, { permissions });
  });
  txn();
}

export function listAudit(db: Db, ctx: Ctx, opts: { q?: string; entity?: string; from?: string; to?: string; page?: number; pageSize?: number }): Paged<Record<string, unknown>> {
  requirePerm(ctx, 'audit.view');
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['a.business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.entity) { where.push('a.entity = ?'); params.push(opts.entity); }
  if (opts.from) { where.push('a.occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('a.occurred_at <= ?'); params.push(opts.to); }
  if (opts.q?.trim()) {
    where.push('(a.action LIKE ? OR u.name LIKE ?)');
    const q = `%${opts.q.trim()}%`;
    params.push(q, q);
  }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Record<string, unknown>[];
  return { rows, total, page, pageSize };
}
