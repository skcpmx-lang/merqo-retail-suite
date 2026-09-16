import crypto from 'node:crypto';
import type { Db } from '../db';
import { seedBusinessDefaults } from '../db';
import { AppError, Ctx, audit } from './_helpers';
import { DEFAULT_ROLE_PERMISSIONS, Role } from '../../shared/constants';
import { nowIso } from '../../shared/dates';
import type { Business, Session, UserSafe } from '../../shared/types';

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function newSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

// In-memory sessions: token -> session
const sessions = new Map<string, { userId: number; businessId: number; createdAt: number; lastActive: number }>();
const SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12h absolute

export function createSession(userId: number, businessId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, { userId, businessId, createdAt: now, lastActive: now });
  return token;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

export function touchSession(token: string): { userId: number; businessId: number } | null {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TIMEOUT_MS) {
    sessions.delete(token);
    return null;
  }
  s.lastActive = Date.now();
  return s;
}

export function permissionsFor(db: Db, businessId: number, role: string): string[] {
  const rows = db
    .prepare('SELECT permission_key, allowed FROM role_permissions WHERE business_id = ? AND role = ?')
    .all(businessId, role) as { permission_key: string; allowed: number }[];
  if (rows.length === 0) {
    // Fall back to compiled defaults
    const d = (DEFAULT_ROLE_PERMISSIONS as Record<string, string[]>)[role];
    return d ? [...d] : [];
  }
  return rows.filter((r) => r.allowed).map((r) => r.permission_key);
}

export function toSafeUser(row: Record<string, unknown>): UserSafe {
  return {
    id: row.id as number,
    name: row.name as string,
    username: row.username as string,
    phone: (row.phone as string) ?? null,
    role: row.role as string,
    active: row.active as number,
    last_login_at: (row.last_login_at as string) ?? null,
    created_at: row.created_at as string,
  };
}

export function getBusiness(db: Db, businessId: number): Business | null {
  return (db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as Business) ?? null;
}

export function isSetupComplete(db: Db): boolean {
  const row = db.prepare('SELECT COUNT(*) AS c FROM businesses').get() as { c: number };
  return row.c > 0;
}

export interface SetupPayload {
  business: { name: string; owner_name?: string; phone?: string; email?: string; address?: string; business_type?: string };
  openingBalances: Record<string, number>; // account code -> paisa
  admin: { name: string; username: string; password: string; phone?: string };
  invoice?: { prefix?: string; footer?: string; terms?: string };
}

export function runSetup(db: Db, payload: SetupPayload): Session {
  if (isSetupComplete(db)) throw new AppError('SETUP_ALREADY_DONE');
  const name = payload.business.name?.trim();
  if (!name) throw new AppError('REQUIRED');
  const username = payload.admin.username?.trim().toLowerCase();
  if (!username || !payload.admin.password || payload.admin.password.length < 6) throw new AppError('WEAK_PASSWORD');
  if (!payload.admin.name?.trim()) throw new AppError('REQUIRED');

  const now = nowIso();
  const txn = db.transaction(() => {
    const biz = db
      .prepare(
        `INSERT INTO businesses (name, owner_name, phone, email, address, business_type, currency, timezone, invoice_prefix, footer, terms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'BDT', 'Asia/Dhaka', ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        payload.business.owner_name?.trim() || null,
        payload.business.phone?.trim() || null,
        payload.business.email?.trim() || null,
        payload.business.address?.trim() || null,
        payload.business.business_type || null,
        payload.invoice?.prefix?.trim() || 'MERQO',
        payload.invoice?.footer || null,
        payload.invoice?.terms || null,
        now,
        now,
      );
    const businessId = Number(biz.lastInsertRowid);
    seedBusinessDefaults(db, businessId, payload.openingBalances);
    // persist role defaults
    const ins = db.prepare('INSERT INTO role_permissions (business_id, role, permission_key, allowed) VALUES (?, ?, ?, 1)');
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) ins.run(businessId, role, p);
    }
    const salt = newSalt();
    const user = db
      .prepare(
        'INSERT INTO users (business_id, name, username, phone, role, password_hash, password_salt, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      )
      .run(businessId, payload.admin.name.trim(), username, payload.admin.phone?.trim() || null, 'owner', hashPassword(payload.admin.password, salt), salt, now, now);
    const userId = Number(user.lastInsertRowid);
    audit(db, { businessId, userId, permissions: [] }, 'business.setup', 'business', businessId, null, { name });
    return { businessId, userId };
  });
  const { businessId, userId } = txn();
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
  const token = createSession(userId, businessId);
  return { token, user: toSafeUser(userRow), permissions: [...DEFAULT_ROLE_PERMISSIONS.owner], business: getBusiness(db, businessId) };
}

export function login(db: Db, username: string, password: string): Session {
  const uname = username?.trim().toLowerCase();
  if (!uname || !password) throw new AppError('INVALID_CREDENTIALS');
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(uname) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('INVALID_CREDENTIALS');
  if (!row.active) throw new AppError('USER_INACTIVE');
  const hash = hashPassword(password, row.password_salt as string);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(row.password_hash as string, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new AppError('INVALID_CREDENTIALS');
  const businessId = row.business_id as number;
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id);
  const token = createSession(row.id as number, businessId);
  audit(db, { businessId, userId: row.id as number, permissions: [] }, 'auth.login', 'user', row.id as number);
  return {
    token,
    user: toSafeUser(row),
    permissions: permissionsFor(db, businessId, row.role as string),
    business: getBusiness(db, businessId),
  };
}

export function changePassword(db: Db, ctx: Ctx, oldPassword: string, newPassword: string): void {
  if (!newPassword || newPassword.length < 6) throw new AppError('WEAK_PASSWORD');
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.userId) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('USER_NOT_FOUND');
  const hash = hashPassword(oldPassword, row.password_salt as string);
  if (hash !== row.password_hash) throw new AppError('INVALID_CREDENTIALS');
  const salt = newSalt();
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').run(hashPassword(newPassword, salt), salt, nowIso(), ctx.userId);
  audit(db, ctx, 'auth.password_change', 'user', ctx.userId);
}

export function ctxFromToken(db: Db, token: string | null | undefined): Ctx {
  if (!token) throw new AppError('NOT_AUTHENTICATED');
  const s = touchSession(token);
  if (!s) throw new AppError('NOT_AUTHENTICATED');
  const row = db.prepare('SELECT role, active FROM users WHERE id = ?').get(s.userId) as { role: Role; active: number } | undefined;
  if (!row || !row.active) throw new AppError('USER_INACTIVE');
  return { businessId: s.businessId, userId: s.userId, permissions: permissionsFor(db, s.businessId, row.role) };
}
