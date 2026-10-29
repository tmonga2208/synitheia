import type { TodayResponse, WeekDayTotals } from '@synitheia/shared';
import type { WeekStripDay } from '../components/WeekStrip.js';

/**
 * One tracker's last seven days, from the week Today already loaded.
 *
 * `live` replaces today's value: the week was fetched when Today last loaded, and a glass
 * logged since then is already in the tracker's own query. Null when the server sent no
 * totals (an older API), so the screen can leave the strip out rather than draw zeros.
 */
export function weekOf(
  today: TodayResponse | undefined,
  pick: (totals: WeekDayTotals) => number,
  live?: number,
): WeekStripDay[] | null {
  const days = today?.weeklyFlow;
  if (!days || days.length === 0 || days.some((d) => !d.totals)) return null;

  return days.map((d) => ({
    localDate: d.localDate,
    isToday: d.isToday,
    value: d.isToday && live !== undefined ? live : pick(d.totals as WeekDayTotals),
  }));
}

export interface WeekSummary {
  /** Average over the days before today that had anything logged; null when none did. */
  usual: number | null;
  /** Days, today included, that reached the target. */
  met: number;
}

/**
 * Today is left out of the average because it is not over yet — a morning would drag
 * the number down every day until evening.
 */
export function summarizeWeek(days: WeekStripDay[], target?: number | null): WeekSummary {
  const past = days.filter((d) => !d.isToday && d.value > 0);
  const usual =
    past.length > 0 ? past.reduce((sum, d) => sum + d.value, 0) / past.length : null;
  const met = target && target > 0 ? days.filter((d) => d.value >= target).length : 0;
  return { usual, met };
}
