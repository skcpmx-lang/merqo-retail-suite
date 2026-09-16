import { describe, it, expect } from 'vitest';
import { toPaisa, fromPaisa, formatMoney, percentOf, splitAmount, mulPaisa } from '@shared/money';

describe('money engine (integer paisa)', () => {
  it('parses decimal taka without float drift (0.1 + 0.2 problem)', () => {
    expect(toPaisa('0.10')).toBe(10);
    expect(toPaisa('0.30')).toBe(30);
    expect(toPaisa(0.1) + toPaisa(0.2)).toBe(30);
  });
  it('parses symbols, commas and Bengali digits', () => {
    expect(toPaisa('৳1,234.50')).toBe(123450);
    expect(toPaisa('১২৩.৪৫')).toBe(12345);
    expect(toPaisa('')).toBe(0);
    expect(toPaisa(null)).toBe(0);
  });
  it('rejects invalid input', () => {
    expect(() => toPaisa('abc')).toThrow('INVALID_AMOUNT');
    expect(() => toPaisa('12.3456789x')).toThrow('INVALID_AMOUNT');
  });
  it('formats with grouping and rounding', () => {
    expect(formatMoney(123450)).toBe('৳1,234.50');
    expect(formatMoney(-500)).toBe('৳-5.00');
    expect(formatMoney(0)).toBe('৳0.00');
    expect(formatMoney(123450, { useBnDigits: true })).toBe('৳১,২৩৪.৫০');
  });
  it('computes percentages half-up in basis points', () => {
    expect(percentOf(10000, 500)).toBe(500); // 5% of 100.00
    expect(percentOf(333, 1000)).toBe(33); // 10% of 3.33 -> 33.3 -> 33
    expect(percentOf(335, 1000)).toBe(34); // 33.5 -> 34 (half-up)
  });
  it('splits amounts with exact reconciliation', () => {
    const parts = splitAmount(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });
  it('multiplies paisa by milli-qty deterministically', () => {
    // 10.00 taka * 1.5 units = 1500 paisa
    expect(mulPaisa(1000, 1500)).toBe(1500);
    // fractional kg: 185.50/kg * 0.250kg = 46.375 -> 46.38 (4638 paisa)
    expect(mulPaisa(18550, 250)).toBe(4638);
  });
  it('round-trips paisa', () => {
    expect(fromPaisa(toPaisa('99.99'))).toBeCloseTo(99.99, 2);
  });
});
