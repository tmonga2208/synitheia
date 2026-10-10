import { describe, expect, it } from 'vitest';
import { dayBounds } from './dayBounds.js';

describe('dayBounds', () => {
  // Built from local-time parts, so every assertion holds in whatever zone the tests run.
  const afternoon = new Date(2026, 6, 12, 15, 30);

  it('covers today from local midnight to the next local midnight', () => {
    const { start, end, localDate } = dayBounds(0, afternoon);

    expect(localDate).toBe('2026-07-12');
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 6, 12]);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    expect([end.getMonth(), end.getDate(), end.getHours()]).toEqual([6, 13, 0]);
  });

  it('steps back whole local days', () => {
    expect(dayBounds(1, afternoon).localDate).toBe('2026-07-11');
    expect(dayBounds(6, afternoon).localDate).toBe('2026-07-06');
  });

  it('crosses a month and a year boundary', () => {
    expect(dayBounds(1, new Date(2026, 7, 1, 9, 0)).localDate).toBe('2026-07-31');
    expect(dayBounds(1, new Date(2027, 0, 1, 0, 5)).localDate).toBe('2026-12-31');
  });

  it('pads single-digit months and days', () => {
    expect(dayBounds(0, new Date(2026, 0, 5, 12, 0)).localDate).toBe('2026-01-05');
  });

  it('gives the same day one minute before midnight as at noon', () => {
    expect(dayBounds(0, new Date(2026, 6, 12, 23, 59)).localDate).toBe('2026-07-12');
    expect(dayBounds(0, new Date(2026, 6, 12, 0, 0)).localDate).toBe('2026-07-12');
  });

  it('makes consecutive days share a boundary, so nothing falls between them', () => {
    expect(dayBounds(1, afternoon).end.getTime()).toBe(dayBounds(0, afternoon).start.getTime());
  });
});
