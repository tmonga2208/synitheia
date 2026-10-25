import {
  asLocalDate,
  currencyMeta,
  firstOfMonth,
  lastOfMonth,
  localWeekdayIndex,
  type LocalDate,
  type MonthKey,
} from '@synitheia/shared';
import type { WireExpenseTotals } from './monthTotal.js';

/**
 * The numbers the Expenses screen opens on: the month against the one before, the
 * calendar's squares, and amounts written with no more digits than they need.
 */

/** An API from before the calendar sends no byDay or topPayees: show plain squares, not an error. */
export function normalizeTotals(raw: Partial<WireExpenseTotals> | undefined): WireExpenseTotals {
  return {
    totalMinor: raw?.totalMinor ?? 0,
    count: raw?.count ?? 0,
    byCategory: raw?.byCategory ?? {},
    largestMinor: raw?.largestMinor ?? null,
    owedMinor: raw?.owedMinor ?? 0,
    byDay: raw?.byDay ?? {},
    topPayees: raw?.topPayees ?? [],
  };
}

/** One quiet line against the previous month, or nothing when it had nothing. */
export function comparisonLine(i: { thisMinor: number; previousMinor: number; previousLabel: string }): string | null {
  if (i.previousMinor <= 0) return null;
  const r = i.thisMinor / i.previousMinor;
  const l = i.previousLabel;
  if (r < 0.5) return `less than half of ${l}`;
  if (r < 0.9) return `less than ${l}`;
  if (r <= 1.1) return `about the same as ${l}`;
  if (r < 2) return `more than ${l}`;
  return `over twice ${l}`;
}

function monthName(month: MonthKey): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function dayOf(date: string): number {
  return Number(date.slice(8, 10));
}

/**
 * What the previous month is compared as. A month still in progress is compared with the
 * previous one up to the same day, or all of it when it is shorter; a month that is over,
 * with all of the previous one.
 */
export function previousComparable(i: {
  previousByDay: Record<string, number>;
  previousMonth: MonthKey;
  ongoingDay: number | null;
}): { minor: number; label: string } {
  const name = monthName(i.previousMonth);
  const last = i.ongoingDay === null ? 31 : Math.min(i.ongoingDay, dayOf(lastOfMonth(i.previousMonth)));
  const minor = Object.entries(i.previousByDay)
    .filter(([date]) => dayOf(date) <= last)
    .reduce((sum, [, v]) => sum + v, 0);
  return { minor, label: i.ongoingDay === null ? name : `this time in ${name}` };
}

export type CalendarCell =
  | { kind: 'blank' }
  | { kind: 'day'; date: LocalDate; day: number; totalMinor: number; strength: number; future: boolean };

/**
 * The month as calendar squares, Monday first. A square's strength is on a log scale
 * against the month's biggest day, so one rent payment does not make every other day
 * look empty.
 */
export function calendarCells(month: MonthKey, byDay: Record<string, number>, today: LocalDate): CalendarCell[] {
  const first = firstOfMonth(month);
  const count = dayOf(lastOfMonth(month));
  const max = Math.max(0, ...Object.values(byDay));
  const cells: CalendarCell[] = Array.from({ length: localWeekdayIndex(first) }, () => ({ kind: 'blank' }) as const);

  for (let day = 1; day <= count; day++) {
    const date = asLocalDate(`${month}-${String(day).padStart(2, '0')}`);
    const totalMinor = byDay[date] ?? 0;
    cells.push({
      kind: 'day',
      date,
      day,
      totalMinor,
      strength: totalMinor > 0 && max > 0 ? Math.log(1 + totalMinor) / Math.log(1 + max) : 0,
      future: date > today,
    });
  }
  return cells;
}

function format(minor: number, currency: string, digits: number): string {
  const { code, decimals, locale } = currencyMeta(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format((digits === 0 ? Math.round(minor / 10 ** decimals) : minor / 10 ** decimals));
}

/** The month's total: "₹85,786". */
export function formatWhole(minor: number, currency: string): string {
  return format(minor, currency, 0);
}

/** A payment: "₹100", or "₹397.96" when there are paise. */
export function formatAmount(minor: number, currency: string): string {
  const { decimals } = currencyMeta(currency);
  return format(minor, currency, minor % 10 ** decimals === 0 ? 0 : decimals);
}
