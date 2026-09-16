import type { Db } from '../db';
import { Ctx, paginate, notify } from './_helpers';
import { getSetting } from './_helpers';
import type { NotificationRow, Paged } from '../../shared/types';

export function listNotifications(db: Db, ctx: Ctx, opts: { unreadOnly?: boolean; page?: number; pageSize?: number }): Paged<NotificationRow> {
  const { limit, offset, page, pageSize } = paginate(opts.page ?? 1, opts.pageSize ?? 50);
  const where = ['business_id = ?'];
  const params: unknown[] = [ctx.businessId];
  if (opts.unreadOnly) where.push('read_at IS NULL');
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE ${w}`).get(...params) as { c: number }).c;
  const unread = (db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE business_id = ? AND read_at IS NULL').get(ctx.businessId) as { c: number }).c;
  const rows = db.prepare(`SELECT * FROM notifications WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as NotificationRow[];
  return { rows, total, page, pageSize, ...( { unread } as object) } as Paged<NotificationRow>;
}

export function markRead(db: Db, ctx: Ctx, id: number): void {
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND business_id = ?').run(new Date().toISOString(), id, ctx.businessId);
}

export function markAllRead(db: Db, ctx: Ctx): void {
  db.prepare('UPDATE notifications SET read_at = ? WHERE business_id = ? AND read_at IS NULL').run(new Date().toISOString(), ctx.businessId);
}

/** Periodic business-rule scan: dues, backup reminder, expiry. Called on startup and daily. */
export function runBusinessScan(db: Db, businessId: number): void {
  const dueNotify = getSetting(db, businessId, 'due_notify', '1') === '1';
  if (dueNotify) {
    const bigDue = db.prepare(
      `SELECT c.name, SUM(l.debit - l.credit) AS due FROM customers c JOIN customer_ledger l ON l.customer_id = c.id
       WHERE c.business_id = ? GROUP BY c.name HAVING due >= 1000000 ORDER BY due DESC LIMIT 5`,
    ).all(businessId) as { name: string; due: number }[];
    for (const d of bigDue) {
      notify(db, businessId, 'customer_due', 'warning', 'বড় বকেয়া', `“${d.name}”-এর বকেয়া ৳${(d.due / 100).toLocaleString('en-US')} ছাড়িয়েছে।`, `due-${d.name}`);
    }
  }
  // Expiry
  const days = parseInt(getSetting(db, businessId, 'expiry_notify_days', '30'), 10) || 30;
  const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const expiring = db.prepare(
    `SELECT p.name, b.expiry_date FROM product_batches b JOIN products p ON p.id = b.product_id
     WHERE p.business_id = ? AND b.expiry_date IS NOT NULL AND b.expiry_date <= ? AND b.qty_milli > 0 LIMIT 10`,
  ).all(businessId, cutoff) as { name: string; expiry_date: string }[];
  for (const e of expiring) {
    notify(db, businessId, 'expiry', 'warning', 'মেয়াদ শেষের পথে', `“${e.name}” ব্যাচের মেয়াদ ${e.expiry_date} তারিখে শেষ হবে।`, `exp-${e.name}-${e.expiry_date}`);
  }
  // Backup reminder
  const reminderDays = parseInt(getSetting(db, businessId, 'backup_reminder_days', '7'), 10) || 7;
  const last = db.prepare('SELECT created_at FROM backups WHERE business_id = ? ORDER BY id DESC LIMIT 1').get(businessId) as { created_at: string } | undefined;
  if (last) {
    const ageDays = (Date.now() - Date.parse(last.created_at)) / 86400000;
    if (ageDays >= reminderDays) {
      notify(db, businessId, 'backup', 'warning', 'ব্যাকআপ নিন', `শেষ ব্যাকআপ নেওয়া হয়েছে ${Math.floor(ageDays)} দিন আগে। আজই ব্যাকআপ নিন।`, 'backup-reminder');
    }
  }
}
