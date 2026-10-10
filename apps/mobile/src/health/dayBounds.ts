export interface DayBounds {
  start: Date;
  end: Date;
  /** `YYYY-MM-DD` in the device's own zone. */
  localDate: string;
}

/**
 * Local midnight-to-midnight, in the device's own zone — the same day the app means.
 *
 * Shared by both platform readers so "Tuesday" is one thing however the health store is
 * asked. `now` is a parameter only so the windows can be tested without the clock.
 */
export function dayBounds(daysAgo: number, now: Date = new Date()): DayBounds {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const localDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
    start.getDate(),
  ).padStart(2, '0')}`;

  return { start, end, localDate };
}
