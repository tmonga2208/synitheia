import {
  addLocalDays,
  eachLocalDay,
  localWeekdayIndex,
  type LocalDate,
} from './local-date.js';

/**
 * A calendar month in the user's own timezone, as `YYYY-MM`.
 *
 * Branded for the same reason LocalDate is: a bare string month is trivially
 * confused with a LocalDate that has lost its day, and every query that filters
 * on `localDate: { $gte, $lte }` would silently match nothing.
 */
export type MonthKey = string & { readonly __brand: 'MonthKey' };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): value is MonthKey {
  return MONTH_RE.test(value);
}

export function asMonthKey(value: string): MonthKey {
  if (!isMonthKey(value)) {
    throw new RangeError(`Invalid MonthKey: "${value}" (expected YYYY-MM)`);
  }
  return value;
}

export function monthKeyOf(localDate: LocalDate): MonthKey {
  return localDate.slice(0, 7) as MonthKey;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function partsOf(month: MonthKey): [year: number, monthIndex: number] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return [y, m];
}

export function firstOfMonth(month: MonthKey): LocalDate {
  return `${month}-01` as LocalDate;
}

/**
 * Computed as "the day before the first of next month" rather than from a table of
 * month lengths, so February and leap years need no special case.
 */
export function lastOfMonth(month: MonthKey): LocalDate {
  return addLocalDays(firstOfMonth(addMonths(month, 1)), -1);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [year, m] = partsOf(month);
  // Shift to a 0-based absolute month count so the arithmetic works in both
  // directions without a December/January special case.
  const absolute = year * 12 + (m - 1) + delta;
  return `${Math.floor(absolute / 12)}-${pad((absolute % 12) + 1)}` as MonthKey;
}

/**
 * The month laid out as whole Monday-anchored weeks.
 *
 * `null` is a cell outside the month — the calendar renders it as empty space, not
 * as a day with no data. Those are different things and the grid must not conflate
 * them: an empty cell is "this square is not a date", a hollow cell is "this date
 * has nothing logged".
 *
 * Always a multiple of 7, so the consumer can chunk it into rows without padding.
 */
export function monthGridCells(month: MonthKey): (LocalDate | null)[] {
  const first = firstOfMonth(month);
  const leading = localWeekdayIndex(first);

  const cells: (LocalDate | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...eachLocalDay(first, lastOfMonth(month)),
  ];

  const trailing = (7 - (cells.length % 7)) % 7;
  return [...cells, ...Array.from({ length: trailing }, () => null)];
}
