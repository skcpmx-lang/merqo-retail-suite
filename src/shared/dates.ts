/**
 * Business-date utilities. Business timezone defaults to Asia/Dhaka.
 * Storage: ISO-8601 UTC strings. Display/filtering: business local dates.
 */

export const DEFAULT_TIMEZONE = 'Asia/Dhaka';
export const DEFAULT_CURRENCY = 'BDT';
export const CURRENCY_SYMBOL = '৳';

export type DatePreset =
  | 'today'
  | 'last7'
  | 'thisMonth'
  | 'last3months'
  | 'last6months'
  | 'thisYear'
  | 'custom';

export interface DateRange {
  preset: DatePreset;
  /** Inclusive local start as YYYY-MM-DD */
  from: string;
  /** Inclusive local end as YYYY-MM-DD */
  to: string;
}

function fmtYMD(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseYMD(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}

function addDaysYMD(ymd: string, days: number): string {
  const { y, m, d } = parseYMD(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function addMonthsYMD(ymd: string, months: number): string {
  const { y, m, d } = parseYMD(ymd);
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const out = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), day));
  return out.toISOString().slice(0, 10);
}

export function todayYMD(tz = DEFAULT_TIMEZONE, now = new Date()): string {
  return fmtYMD(now, tz);
}

/** Resolve a preset into an inclusive local date range. */
export function resolvePreset(preset: DatePreset, tz = DEFAULT_TIMEZONE, now = new Date(), custom?: { from: string; to: string }): DateRange {
  const today = todayYMD(tz, now);
  switch (preset) {
    case 'today':
      return { preset, from: today, to: today };
    case 'last7':
      return { preset, from: addDaysYMD(today, -6), to: today };
    case 'thisMonth':
      return { preset, from: today.slice(0, 7) + '-01', to: today };
    case 'last3months':
      return { preset, from: addMonthsYMD(today, -3), to: today };
    case 'last6months':
      return { preset, from: addMonthsYMD(today, -6), to: today };
    case 'thisYear':
      return { preset, from: today.slice(0, 4) + '-01-01', to: today };
    case 'custom':
      return { preset, from: custom?.from ?? today, to: custom?.to ?? today };
  }
}

/** Convert an inclusive local range into UTC ISO bounds for querying. */
export function rangeToUtcBounds(range: DateRange, tz = DEFAULT_TIMEZONE): { fromUtc: string; toUtc: string } {
  // Local midnight boundaries converted via offset probe.
  const offsetMs = (ymd: string, endOfDay: boolean): number => {
    const guess = new Date(`${ymd}T${endOfDay ? '23:59:59.999' : '00:00:00'}Z`);
    const local = new Date(guess.toLocaleString('en-US', { timeZone: tz }));
    const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
    return local.getTime() - utc.getTime();
  };
  const fromUtc = new Date(new Date(`${range.from}T00:00:00Z`).getTime() - offsetMs(range.from, false)).toISOString();
  const toUtc = new Date(new Date(`${range.to}T23:59:59.999Z`).getTime() - offsetMs(range.to, true)).toISOString();
  return { fromUtc, toUtc };
}

export function toBusinessDay(isoUtc: string, tz = DEFAULT_TIMEZONE): string {
  return fmtYMD(new Date(isoUtc), tz);
}

export function formatDateTime(isoUtc: string, tz = DEFAULT_TIMEZONE, locale = 'bn-BD'): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(isoUtc));
  } catch {
    return isoUtc;
  }
}

export function formatDate(ymdOrIso: string, tz = DEFAULT_TIMEZONE, locale = 'bn-BD'): string {
  try {
    const d = ymdOrIso.length === 10 ? new Date(`${ymdOrIso}T12:00:00Z`) : new Date(ymdOrIso);
    return new Intl.DateTimeFormat(locale, { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return ymdOrIso;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Age bucket for receivables/payables aging. */
export function ageBucket(occurredUtc: string, tz = DEFAULT_TIMEZONE, now = new Date()): 'current' | 'd1_7' | 'd8_30' | 'd31_90' | 'd90plus' {
  const day = toBusinessDay(occurredUtc, tz);
  const today = todayYMD(tz, now);
  const diff = Math.round((Date.parse(today) - Date.parse(day)) / 86400000);
  if (diff <= 0) return 'current';
  if (diff <= 7) return 'd1_7';
  if (diff <= 30) return 'd8_30';
  if (diff <= 90) return 'd31_90';
  return 'd90plus';
}
