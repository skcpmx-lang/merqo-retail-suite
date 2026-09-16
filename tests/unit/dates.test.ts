import { describe, it, expect } from 'vitest';
import { resolvePreset, rangeToUtcBounds, todayYMD, ageBucket } from '@shared/dates';

describe('business dates (Asia/Dhaka)', () => {
  const tz = 'Asia/Dhaka';
  it('resolves presets to inclusive ranges', () => {
    const now = new Date('2026-03-15T10:00:00Z'); // 16:00 Dhaka
    expect(resolvePreset('today', tz, now)).toEqual({ preset: 'today', from: '2026-03-15', to: '2026-03-15' });
    const last7 = resolvePreset('last7', tz, now);
    expect(last7.from).toBe('2026-03-09');
    expect(last7.to).toBe('2026-03-15');
    const m = resolvePreset('thisMonth', tz, now);
    expect(m.from).toBe('2026-03-01');
    const y = resolvePreset('thisYear', tz, now);
    expect(y.from).toBe('2026-01-01');
  });
  it('converts local range to UTC bounds (Dhaka = UTC+6)', () => {
    const { fromUtc, toUtc } = rangeToUtcBounds({ preset: 'custom', from: '2026-03-15', to: '2026-03-15' }, tz);
    expect(fromUtc).toBe('2026-03-14T18:00:00.000Z');
    expect(toUtc.startsWith('2026-03-15T17:59:59')).toBe(true);
  });
  it('computes today in Dhaka even near midnight UTC', () => {
    // 2026-03-15 01:00 UTC = 07:00 Dhaka same day
    expect(todayYMD(tz, new Date('2026-03-15T01:00:00Z'))).toBe('2026-03-15');
    // 2026-03-15 20:00 UTC = 2026-03-16 02:00 Dhaka next day
    expect(todayYMD(tz, new Date('2026-03-15T20:00:00Z'))).toBe('2026-03-16');
  });
  it('buckets aging correctly', () => {
    const now = new Date('2026-03-15T10:00:00Z');
    expect(ageBucket('2026-03-15T04:00:00.000Z', tz, now)).toBe('current');
    expect(ageBucket('2026-03-10T04:00:00.000Z', tz, now)).toBe('d1_7');
    expect(ageBucket('2026-02-20T04:00:00.000Z', tz, now)).toBe('d8_30');
    expect(ageBucket('2026-01-20T04:00:00.000Z', tz, now)).toBe('d31_90');
    expect(ageBucket('2025-01-01T04:00:00.000Z', tz, now)).toBe('d90plus');
  });
});
