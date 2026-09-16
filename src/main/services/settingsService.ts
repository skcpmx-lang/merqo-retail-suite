import type { Db } from '../db';
import { AppError, Ctx, audit, requirePerm } from './_helpers';
import { nowIso } from '../../shared/dates';
import { sanitizeText } from '../../shared/validators';
import type { Business } from '../../shared/types';

export function getBusinessProfile(db: Db, ctx: Ctx): Business {
  const row = db.prepare('SELECT * FROM businesses WHERE id = ?').get(ctx.businessId) as Business | undefined;
  if (!row) throw new AppError('DB_ERROR');
  return row;
}

export function updateBusinessProfile(
  db: Db, ctx: Ctx,
  input: Partial<{
    name: string; owner_name: string | null; phone: string | null; email: string | null; address: string | null;
    business_type: string | null; invoice_prefix: string; footer: string | null; terms: string | null;
    tax_default_bp: number; tax_mode: string; negative_stock_allowed: boolean; overpayment_policy: string;
    digit_locale: string; receipt_width: string; timezone: string; logo: string | null;
  }>,
): Business {
  requirePerm(ctx, 'settings.edit');
  const old = getBusinessProfile(db, ctx);
  if (input.name !== undefined && !input.name.trim()) throw new AppError('REQUIRED');
  if (input.logo !== undefined && input.logo !== null) {
    // Logo is stored inline as a data URL so invoices/receipts can embed it offline.
    if (!/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(input.logo) || input.logo.length > 400_000) {
      throw new AppError('INVALID_LOGO');
    }
  }
  db.prepare(
    `UPDATE businesses SET name = COALESCE(?, name), owner_name = ?, phone = ?, email = ?, address = ?, business_type = ?,
     invoice_prefix = COALESCE(?, invoice_prefix), footer = ?, terms = ?, logo_path = ?,
     tax_default_bp = COALESCE(?, tax_default_bp), tax_mode = COALESCE(?, tax_mode),
     negative_stock_allowed = COALESCE(?, negative_stock_allowed), overpayment_policy = COALESCE(?, overpayment_policy),
     digit_locale = COALESCE(?, digit_locale), receipt_width = COALESCE(?, receipt_width), timezone = COALESCE(?, timezone),
     updated_at = ? WHERE id = ?`,
  ).run(
    input.name?.trim() || null,
    input.owner_name !== undefined ? sanitizeText(input.owner_name, 200) : old.owner_name,
    input.phone !== undefined ? sanitizeText(input.phone, 30) : old.phone,
    input.email !== undefined ? sanitizeText(input.email, 100) : old.email,
    input.address !== undefined ? sanitizeText(input.address, 500) : old.address,
    input.business_type !== undefined ? sanitizeText(input.business_type, 100) : old.business_type,
    input.invoice_prefix?.trim() || null,
    input.footer !== undefined ? sanitizeText(input.footer, 1000) : old.footer,
    input.terms !== undefined ? sanitizeText(input.terms, 2000) : old.terms,
    input.logo !== undefined ? input.logo : old.logo_path,
    input.tax_default_bp ?? null,
    input.tax_mode ?? null,
    input.negative_stock_allowed === undefined ? null : input.negative_stock_allowed ? 1 : 0,
    input.overpayment_policy ?? null,
    input.digit_locale ?? null,
    input.receipt_width ?? null,
    input.timezone ?? null,
    nowIso(), ctx.businessId,
  );
  // Audit without the (potentially large) inline logo payload.
  const { logo: _logo, ...auditInput } = input;
  audit(db, ctx, 'settings.business_update', 'business', ctx.businessId, null, { ...auditInput, logo: input.logo !== undefined ? (input.logo ? 'set' : 'removed') : undefined });
  return getBusinessProfile(db, ctx);
}

export function getSettings(db: Db, ctx: Ctx): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings WHERE business_id = ?').all(ctx.businessId) as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSetting(db: Db, ctx: Ctx, key: string, value: string): void {
  requirePerm(ctx, 'settings.edit');
  const k = key.trim().slice(0, 100);
  if (!k) throw new AppError('REQUIRED');
  db.prepare('INSERT INTO settings (business_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(
    ctx.businessId, k, String(value).slice(0, 5000), nowIso(),
  );
  audit(db, ctx, 'settings.update', 'setting', null, { key: k }, { value: String(value).slice(0, 200) });
}
