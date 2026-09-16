import { describe, it, expect } from 'vitest';
import { toMilli, fromMilli, formatQty } from '@shared/qty';

describe('quantity engine (milli-units)', () => {
  it('converts units to milli', () => {
    expect(toMilli(1)).toBe(1000);
    expect(toMilli('2.5')).toBe(2500);
    expect(toMilli('0.333')).toBe(333);
    expect(toMilli(null)).toBe(0);
  });
  it('rejects non-numeric', () => {
    expect(() => toMilli('abc')).toThrow('INVALID_QTY');
  });
  it('formats trimming zeros', () => {
    expect(formatQty(1000)).toBe('1');
    expect(formatQty(2500)).toBe('2.5');
    expect(formatQty(2333)).toBe('2.333');
    expect(formatQty(12000)).toBe('12');
  });
  it('round-trips', () => {
    expect(fromMilli(toMilli(3.75))).toBeCloseTo(3.75, 3);
  });
});
