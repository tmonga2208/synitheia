import { describe, expect, it } from 'vitest';
import { asLocalDate } from './local-date.js';
import {
  addMonths,
  asMonthKey,
  firstOfMonth,
  isMonthKey,
  lastOfMonth,
  monthGridCells,
  monthKeyOf,
} from './month-grid.js';

describe('isMonthKey', () => {
  it('accepts YYYY-MM', () => {
    expect(isMonthKey('2026-07')).toBe(true);
    expect(isMonthKey('2026-12')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isMonthKey('2026-7')).toBe(false);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-07-01')).toBe(false);
    expect(isMonthKey('')).toBe(false);
  });
});

describe('asMonthKey', () => {
  it('throws on a malformed month', () => {
    expect(() => asMonthKey('2026-13')).toThrow(RangeError);
  });
});

describe('month boundaries', () => {
  it('finds the first and last day', () => {
    expect(firstOfMonth(asMonthKey('2026-07'))).toBe('2026-07-01');
    expect(lastOfMonth(asMonthKey('2026-07'))).toBe('2026-07-31');
  });

  it('handles 30-day months and February', () => {
    expect(lastOfMonth(asMonthKey('2026-06'))).toBe('2026-06-30');
    expect(lastOfMonth(asMonthKey('2026-02'))).toBe('2026-02-28');
    expect(lastOfMonth(asMonthKey('2024-02'))).toBe('2024-02-29'); // leap
  });

  it('rolls across December', () => {
    expect(lastOfMonth(asMonthKey('2026-12'))).toBe('2026-12-31');
    expect(addMonths(asMonthKey('2026-12'), 1)).toBe('2027-01');
    expect(addMonths(asMonthKey('2026-01'), -1)).toBe('2025-12');
    expect(addMonths(asMonthKey('2026-07'), -3)).toBe('2026-04');
  });

  it('derives a month from a day', () => {
    expect(monthKeyOf(asLocalDate('2026-07-18'))).toBe('2026-07');
  });
});

describe('monthGridCells', () => {
  it('pads a Wednesday-start month with two leading blanks', () => {
    // 2026-07-01 is a Wednesday -> Monday-index 2.
    const cells = monthGridCells(asMonthKey('2026-07'));

    expect(cells.length).toBe(35); // 5 rows of 7
    expect(cells.slice(0, 2)).toEqual([null, null]);
    expect(cells[2]).toBe('2026-07-01');
    expect(cells[32]).toBe('2026-07-31');
    expect(cells.slice(33)).toEqual([null, null]);
  });

  it('adds no leading blanks when the month starts on a Monday', () => {
    // 2026-06-01 is a Monday.
    const cells = monthGridCells(asMonthKey('2026-06'));

    expect(cells[0]).toBe('2026-06-01');
    expect(cells.length).toBe(35);
    expect(cells.filter((c) => c !== null).length).toBe(30);
  });

  it('spills to six rows when a long month starts on a Sunday', () => {
    // 2026-11-01 is a Sunday -> Monday-index 6, plus 30 days = 36 cells.
    const cells = monthGridCells(asMonthKey('2026-11'));

    expect(cells.length).toBe(42); // 6 rows of 7
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe('2026-11-01');
  });

  it('covers a leap February exactly', () => {
    // 2024-02-01 is a Thursday -> Monday-index 3.
    const cells = monthGridCells(asMonthKey('2024-02'));

    expect(cells.slice(0, 3)).toEqual([null, null, null]);
    expect(cells[3]).toBe('2024-02-01');
    expect(cells.filter((c) => c !== null)).toHaveLength(29);
    expect(cells.length % 7).toBe(0);
  });

  it('always returns whole weeks', () => {
    for (const month of ['2026-01', '2026-02', '2026-08', '2027-05']) {
      expect(monthGridCells(asMonthKey(month)).length % 7).toBe(0);
    }
  });
});
