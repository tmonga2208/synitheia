import { describe, expect, it } from 'vitest';
import { asLocalDate } from './local-date.js';
import { asMonthKey } from './month-grid.js';
import {
  formatClockTime,
  formatDayLabel,
  formatMonthLabel,
  formatShortDayLabel,
} from './format.js';

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

describe('formatClockTime', () => {
  it('writes a stored 24-hour time the way the rest of the app writes times', () => {
    expect(formatClockTime('19:30')).toBe('7:30 PM');
    expect(formatClockTime('07:00')).toBe('7:00 AM');
    expect(formatClockTime('08:05')).toBe('8:05 AM');
  });

  it('calls midnight and noon twelve', () => {
    expect(formatClockTime('00:00')).toBe('12:00 AM');
    expect(formatClockTime('12:00')).toBe('12:00 PM');
    expect(formatClockTime('12:45')).toBe('12:45 PM');
    expect(formatClockTime('23:59')).toBe('11:59 PM');
  });

  it('gives back what it was handed when that is not a time', () => {
    expect(formatClockTime('soon')).toBe('soon');
    expect(formatClockTime('25:00')).toBe('25:00');
    expect(formatClockTime('')).toBe('');
  });
});
