import type { LocalDate } from './local-date.js';
import { firstOfMonth, type MonthKey } from './month-grid.js';

/**
 * A LocalDate is a bare calendar label with no timezone attached. Anchoring it at
 * UTC midnight and formatting it *in UTC* is the only way to render it without some
 * zone silently shifting it a day — which is exactly the class of bug local-date.ts
 * exists to prevent.
 */
function anchor(localDate: LocalDate | string): Date {
  return new Date(`${localDate.slice(0, 10)}T00:00:00Z`);
}

const DAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

const SHORT_DAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const MONTH = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Saturday, July 18" */
export function formatDayLabel(localDate: LocalDate): string {
  return DAY.format(anchor(localDate));
}

/** "Sat, Jul 18" */
export function formatShortDayLabel(localDate: LocalDate): string {
  return SHORT_DAY.format(anchor(localDate));
}

/** "July 2026" */
export function formatMonthLabel(month: MonthKey): string {
  return MONTH.format(anchor(firstOfMonth(month)));
}
