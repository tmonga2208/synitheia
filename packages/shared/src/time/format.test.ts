import { describe, expect, it } from 'vitest';
import { asLocalDate } from './local-date.js';
import { asMonthKey } from './month-grid.js';
import { formatDayLabel, formatMonthLabel, formatShortDayLabel } from './format.js';

describe('formatDayLabel', () => {
  it('renders the weekday, month and day', () => {
    expect(formatDayLabel(asLocalDate('2026-07-18'))).toBe('Saturday, July 18');
  });

  it('does not shift across the first of the month', () => {
    // The classic failure: a negative-offset host zone renders this as June 30.
    expect(formatDayLabel(asLocalDate('2026-07-01'))).toBe('Wednesday, July 1');
  });

  it('does not shift across new year', () => {
    expect(formatDayLabel(asLocalDate('2026-01-01'))).toBe('Thursday, January 1');
  });
});

describe('formatShortDayLabel', () => {
  it('abbreviates', () => {
    expect(formatShortDayLabel(asLocalDate('2026-07-18'))).toBe('Sat, Jul 18');
  });
});

describe('formatMonthLabel', () => {
  it('renders the month and year', () => {
    expect(formatMonthLabel(asMonthKey('2026-07'))).toBe('July 2026');
    expect(formatMonthLabel(asMonthKey('2026-01'))).toBe('January 2026');
  });
});
