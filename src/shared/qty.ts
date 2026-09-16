/** Quantity engine: integer milli-units (1000 = 1 unit) supports fractional kg/liter safely. */

export const MILLI = 1000;

export function toMilli(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  const n = typeof input === 'number' ? input : Number(String(input).trim().replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error('INVALID_QTY');
  return Math.round(n * MILLI);
}

export function fromMilli(milli: number): number {
  return milli / MILLI;
}

/** Display: trim trailing zeros, max 3 decimals. */
export function formatQty(milli: number, useBnDigits = false): string {
  const v = milli / MILLI;
  let s: string;
  if (Number.isInteger(v)) s = v.toString();
  else s = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (useBnDigits) s = s.replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
  return s;
}
