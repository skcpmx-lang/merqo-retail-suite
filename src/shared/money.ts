/**
 * MERQO money engine.
 * All financial values are represented as INTEGER paisa (1 BDT = 100 paisa).
 * Never use floating point for money. All rounding is explicit (half-up).
 */

export const PAISA_PER_TAKA = 100;

/** Parse user input (string/number) into integer paisa. Throws Bengali-safe Error on invalid. */
export function toPaisa(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('INVALID_AMOUNT');
    return Math.round(input * PAISA_PER_TAKA);
  }
  const s = String(input).trim().replace(/[৳,\s]/g, '');
  // Accept Bengali digits too
  const latin = s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  if (!/^-?\d+(\.\d{1,4})?$/.test(latin)) throw new Error('INVALID_AMOUNT');
  const [takaPart, fracPart = ''] = latin.split('.');
  const sign = takaPart.startsWith('-') ? -1 : 1;
  const taka = Math.abs(parseInt(takaPart, 10));
  const frac = (fracPart + '00').slice(0, 2);
  const third = fracPart.length > 2 ? parseInt(fracPart.slice(2, 3), 10) : 0;
  let paisa = taka * 100 + parseInt(frac || '0', 10);
  if (third >= 5) paisa += 1; // half-up on extra precision
  return sign * paisa;
}

export function fromPaisa(paisa: number): number {
  return paisa / PAISA_PER_TAKA;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
export function toBnDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/** Format paisa as "৳1,234.50" (latin digits) or "৳১,২৩৪.৫০" when useBnDigits. */
export function formatMoney(paisa: number, opts?: { symbol?: boolean; useBnDigits?: boolean }): string {
  const { symbol = true, useBnDigits = false } = opts ?? {};
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paisa));
  const taka = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = taka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let out = `${sign}${grouped}.${frac}`;
  if (useBnDigits) out = toBnDigits(out);
  return symbol ? `৳${out}` : out;
}

/** Percentage of a paisa amount in basis points (1% = 100bp), half-up rounded. */
export function percentOf(amountPaisa: number, rateBp: number): number {
  return Math.round((amountPaisa * rateBp) / 10000);
}

/** Split a total into N parts with exact reconciliation (largest remainder). */
export function splitAmount(totalPaisa: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || weights.length === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalPaisa * w) / sum);
  const base = raw.map(Math.floor);
  let remainder = totalPaisa - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (remainder <= 0) break;
    base[i] += 1;
    remainder -= 1;
  }
  return base;
}

export function add(...vals: number[]): number {
  return vals.reduce((a, b) => a + b, 0);
}
export function sub(a: number, b: number): number {
  return a - b;
}
/** Multiply paisa by a decimal factor string/number safely (e.g. qty * price). */
export function mulPaisa(paisa: number, factorMilli: number): number {
  // factorMilli: quantity in milli-units (1000 = 1 unit)
  return Math.round((paisa * factorMilli) / 1000);
}

export function isValidMoney(paisa: number): boolean {
  return Number.isInteger(paisa) && Number.isSafeInteger(paisa);
}
