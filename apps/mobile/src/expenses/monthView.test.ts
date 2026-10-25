import { describe, expect, it } from 'vitest';
import { asLocalDate, asMonthKey } from '@synitheia/shared';
import {
  calendarCells,
  comparisonLine,
  formatAmount,
  formatWhole,
  normalizeTotals,
  previousComparable,
  type CalendarCell,
} from './monthView.js';

const line = (thisMinor: number, previousMinor: number) =>
  comparisonLine({ thisMinor, previousMinor, previousLabel: 'August' });

describe('comparisonLine', () => {
  it('reads each band of the table, edges included', () => {
    expect(line(40, 100)).toBe('less than half of August');
    expect(line(50, 100)).toBe('less than August');
    expect(line(89, 100)).toBe('less than August');
    expect(line(90, 100)).toBe('about the same as August');
    expect(line(110, 100)).toBe('about the same as August');
    expect(line(111, 100)).toBe('more than August');
    expect(line(199, 100)).toBe('more than August');
    expect(line(200, 100)).toBe('over twice August');
  });

  it('says nothing when there is nothing to compare with', () => {
    expect(line(100, 0)).toBeNull();
  });
});

describe('previousComparable', () => {
  const august = { '2026-08-03': 1000, '2026-08-20': 2000, '2026-08-31': 4000 };
  const september = { '2026-09-03': 1000, '2026-09-30': 5000 };

  it('compares a finished month with the whole previous month', () => {
    expect(previousComparable({ previousByDay: august, previousMonth: asMonthKey('2026-08'), ongoingDay: null })).toEqual({
      minor: 7000,
      label: 'August',
    });
  });

  it('compares the current month with the previous one up to the same day', () => {
    expect(previousComparable({ previousByDay: august, previousMonth: asMonthKey('2026-08'), ongoingDay: 20 })).toEqual({
      minor: 3000,
      label: 'this time in August',
    });
  });

  it('counts all of a shorter previous month on the 31st', () => {
    expect(previousComparable({ previousByDay: september, previousMonth: asMonthKey('2026-09'), ongoingDay: 31 })).toEqual({
      minor: 6000,
      label: 'this time in September',
    });
  });
});

const days = (cells: CalendarCell[]) => cells.filter((c): c is Extract<CalendarCell, { kind: 'day' }> => c.kind === 'day');

describe('calendarCells', () => {
  it('starts September 2026 on its Tuesday, Monday first, with every day and none to come', () => {
    const cells = calendarCells(asMonthKey('2026-09'), {}, asLocalDate('2026-10-26'));

    expect(cells[0]).toEqual({ kind: 'blank' });
    expect(cells[1]).toMatchObject({ kind: 'day', day: 1, date: '2026-09-01' });
    expect(days(cells)).toHaveLength(30);
    expect(days(cells).some((d) => d.future)).toBe(false);
  });

  it('marks the days still to come in the current month', () => {
    const cells = days(calendarCells(asMonthKey('2026-10'), {}, asLocalDate('2026-10-26')));

    expect(cells.filter((d) => d.future).map((d) => d.day)).toEqual([27, 28, 29, 30, 31]);
  });

  it('keeps a small day visible beside a very large one', () => {
    const cells = days(calendarCells(asMonthKey('2026-09'), { '2026-09-04': 4937200, '2026-09-30': 10000 }, asLocalDate('2026-10-26')));

    expect(cells.find((d) => d.day === 4)!.strength).toBe(1);
    expect(cells.find((d) => d.day === 30)!.strength).toBeGreaterThan(0.4);
    expect(cells.find((d) => d.day === 30)!.totalMinor).toBe(10000);
  });

  it('leaves every square plain in an empty month', () => {
    expect(days(calendarCells(asMonthKey('2026-09'), {}, asLocalDate('2026-10-26'))).every((d) => d.strength === 0)).toBe(true);
  });
});

describe('normalizeTotals', () => {
  it('fills what an API from before calendars does not send', () => {
    expect(normalizeTotals({ totalMinor: 5, count: 1 })).toMatchObject({ totalMinor: 5, count: 1, byDay: {}, topPayees: [] });
    expect(normalizeTotals(undefined)).toMatchObject({ totalMinor: 0, count: 0, byDay: {}, topPayees: [] });
  });
});

describe('amounts', () => {
  it('writes the month total in whole rupees', () => {
    expect(formatWhole(8578610, 'INR')).toBe('₹85,786');
  });

  it('writes paise only when there are some', () => {
    expect(formatAmount(10000, 'INR')).toBe('₹100');
    expect(formatAmount(39796, 'INR')).toBe('₹397.96');
  });
});
