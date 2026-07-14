import { TZDate } from '@date-fns/tz';

/**
 * A calendar day in the user's own timezone, as `YYYY-MM-DD`.
 *
 * Branded so it cannot be confused with an arbitrary string. Every timestamped
 * record in the system stores one of these alongside its UTC instant, and every
 * "today" / "this week" / "this month" query filters on it. Filtering on a UTC
 * range instead is the single most common source of off-by-one-day bugs in
 * trackers, because a user in Asia/Kolkata (UTC+5:30) logging water at 11pm
 * would land on the *next* UTC day.
 */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: string): value is LocalDate {
  if (!LOCAL_DATE_RE.test(value)) return false;
  // Reject impossible dates that still match the shape, e.g. 2026-02-31.
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

export function asLocalDate(value: string): LocalDate {
  if (!isLocalDate(value)) {
    throw new RangeError(`Invalid LocalDate: "${value}" (expected YYYY-MM-DD)`);
  }
  return value;
}

export function isValidTimeZone(tz: string): boolean {
  // ICU accepts bare abbreviations like "IST" and "EST", but they are ambiguous
  // ("IST" is India, Ireland, and Israel) and carry no DST rules. Only accept real
  // IANA zone identifiers, which are Region/City — plus UTC, the one legal exception.
  if (tz !== 'UTC' && !tz.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function assertTimeZone(tz: string): void {
  if (!isValidTimeZone(tz)) {
    throw new RangeError(`Invalid IANA timezone: "${tz}"`);
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The calendar day `instant` fell on, as observed in `timeZone`. */
export function toLocalDate(instant: Date, timeZone: string): LocalDate {
  assertTimeZone(timeZone);
  const zoned = new TZDate(instant, timeZone);
  return `${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}` as LocalDate;
}

/** The UTC instant at which `localDate` begins in `timeZone`. */
export function startOfLocalDay(localDate: LocalDate, timeZone: string): Date {
  assertTimeZone(timeZone);
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(new TZDate(y, m - 1, d, 0, 0, 0, 0, timeZone).getTime());
}

/**
 * The UTC half-open interval `[start, end)` covering `localDate` in `timeZone`.
 *
 * Half-open, not inclusive-end, so that DST transitions (where a local day can
 * be 23 or 25 hours long) and millisecond-boundary events can't be double-counted
 * or dropped.
 */
export function localDayRange(
  localDate: LocalDate,
  timeZone: string,
): { start: Date; end: Date } {
  const start = startOfLocalDay(localDate, timeZone);
  const end = startOfLocalDay(addLocalDays(localDate, 1), timeZone);
  return { start, end };
}

/** The UTC half-open interval covering `[from, to]` inclusive of both local days. */
export function localDateRange(
  from: LocalDate,
  to: LocalDate,
  timeZone: string,
): { start: Date; end: Date } {
  if (from > to) throw new RangeError(`localDateRange: "${from}" is after "${to}"`);
  return {
    start: startOfLocalDay(from, timeZone),
    end: startOfLocalDay(addLocalDays(to, 1), timeZone),
  };
}

/**
 * Calendar arithmetic below is done entirely in UTC and never touches date-fns.
 *
 * date-fns' `addDays`/`startOfWeek` operate on the *host machine's* local time, so
 * feeding them a UTC-constructed Date and reading the result back with UTC getters
 * silently shifts by a day whenever the server's own timezone is offset from UTC.
 * A LocalDate is a bare calendar label with no timezone attached; the only correct
 * way to do arithmetic on it is to pin it to UTC midnight, where no offset or DST
 * rule can perturb it. The server's timezone must never influence a user's day.
 */
function toUtcMidnight(localDate: LocalDate): Date {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtcMidnight(date: Date): LocalDate {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}` as LocalDate;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function addLocalDays(localDate: LocalDate, days: number): LocalDate {
  return fromUtcMidnight(new Date(toUtcMidnight(localDate).getTime() + days * MS_PER_DAY));
}

/** Whole calendar days from `a` to `b`. Negative when `b` precedes `a`. */
export function diffLocalDays(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtcMidnight(b).getTime() - toUtcMidnight(a).getTime()) / MS_PER_DAY);
}

export function todayLocalDate(timeZone: string, now: Date = new Date()): LocalDate {
  return toLocalDate(now, timeZone);
}

/** Monday-anchored, matching the M–S week in the Weekly Analysis chart. */
export function startOfLocalWeek(localDate: LocalDate): LocalDate {
  return addLocalDays(localDate, -localWeekdayIndex(localDate));
}

export function startOfLocalMonth(localDate: LocalDate): LocalDate {
  return `${localDate.slice(0, 7)}-01` as LocalDate;
}

/** Every local day in `[from, to]`, inclusive. */
export function eachLocalDay(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let cur = from; cur <= to; cur = addLocalDays(cur, 1)) out.push(cur);
  return out;
}

/** Local wall-clock minutes since midnight — used to bucket habits/expenses by time of day. */
export function localMinutesOfDay(instant: Date, timeZone: string): number {
  assertTimeZone(timeZone);
  const zoned = new TZDate(instant, timeZone);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

/** 0 = Monday … 6 = Sunday, matching the chart's column order. */
export function localWeekdayIndex(localDate: LocalDate): number {
  return (toUtcMidnight(localDate).getUTCDay() + 6) % 7;
}
