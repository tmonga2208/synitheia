/** "1:04 PM" in the user's zone. */
export function timeLabel(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(instant);
}

/** Minutes since local midnight → "8:40 AM". No zone: the input is already local. */
export function minutesLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Indexed by `localWeekdayIndex`: 0 = Monday … 6 = Sunday. */
export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
