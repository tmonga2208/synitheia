import { z } from 'zod';
import { diffLocalDays, type LocalDate } from '../time/local-date.js';
import { localDateSchema, monthKeySchema } from './common.js';
import { computeDailyFlow, type FlowComponent } from './today.js';

/** A day counts toward a run at or above this flow percentage. */
export const FLOW_RUN_THRESHOLD = 60;

/**
 * The slice of a DailySummary that the flow percentage is computed from.
 *
 * Declared structurally rather than importing the Mongoose document type, so this
 * stays a pure function the client can also run.
 */
export interface FlowSummaryInput {
  habits: { scheduled: number; completionRate: number };
  water: { totalMl: number; targetMl: number; entryCount: number };
  nutrition: { totals: { calories: number }; calorieTarget: number; entryCount: number };
}

/**
 * One historical day's flow percentage.
 *
 * A tracker with no entries that day is EXCLUDED rather than scored zero — matching
 * the Weekly Analysis chart, which is the other place historical days are scored. A
 * user who has never opened the food tracker must not have every past day capped at
 * 67% by a tracker they never used. Habits are the exception: a scheduled habit that
 * was not completed is a genuine zero, not an absence.
 */
export function flowPercentForSummary(
  summary: FlowSummaryInput,
  trackedDomains: readonly string[],
): number {
  const tracked = new Set(trackedDomains);

  const components: FlowComponent[] = [
    {
      key: 'habits',
      percent: summary.habits.completionRate * 100,
      active: tracked.has('habits') && summary.habits.scheduled > 0,
    },
    {
      key: 'water',
      percent: (summary.water.totalMl / summary.water.targetMl) * 100,
      active: tracked.has('water') && summary.water.entryCount > 0,
    },
    {
      key: 'nutrition',
      percent:
        (summary.nutrition.totals.calories / summary.nutrition.calorieTarget) * 100,
      active: tracked.has('nutrition') && summary.nutrition.entryCount > 0,
    },
  ];

  return computeDailyFlow(components).percent;
}

export const monthDaySchema = z.object({
  localDate: localDateSchema,
  percent: z.number().int().min(0).max(100),
  eventCount: z.number().int().nonnegative(),
});
export type MonthDay = z.infer<typeof monthDaySchema> & { localDate: LocalDate };

export const monthStatsSchema = z.object({
  avgPercent: z.number().int().min(0).max(100),
  daysLogged: z.number().int().nonnegative(),
  /** Longest consecutive run at or above FLOW_RUN_THRESHOLD. NOT the habit streak. */
  bestFlowRun: z.number().int().nonnegative(),
});
export type MonthStats = z.infer<typeof monthStatsSchema>;

/**
 * Statistics over the days that exist.
 *
 * Absent days are absent, not zero — averaging over the whole calendar month would
 * report a diligent three-day-old account as a 10% month.
 */
export function monthStats(days: readonly MonthDay[]): MonthStats {
  if (days.length === 0) return { avgPercent: 0, daysLogged: 0, bestFlowRun: 0 };

  const sorted = [...days].sort((a, b) => a.localDate.localeCompare(b.localDate));

  const avgPercent = Math.round(
    sorted.reduce((acc, d) => acc + d.percent, 0) / sorted.length,
  );

  let best = 0;
  let run = 0;
  let previous: LocalDate | null = null;

  for (const d of sorted) {
    // A calendar gap breaks the run even if both sides clear the threshold — the
    // user did not keep it up through a day they logged nothing at all.
    const contiguous = previous !== null && diffLocalDays(previous, d.localDate) === 1;
    run = d.percent >= FLOW_RUN_THRESHOLD ? (contiguous ? run + 1 : 1) : 0;
    if (run > best) best = run;
    previous = d.localDate;
  }

  return { avgPercent, daysLogged: sorted.length, bestFlowRun: best };
}

/**
 * The History grid, in one request.
 *
 * Days with nothing logged are ABSENT from `days` rather than present with
 * `percent: 0`. The client draws those hollow. "You weren't using the app" and
 * "you scored zero" are different statements and the wire format must preserve
 * the difference — the same reason `activity.steps` is nullable in DailySummary.
 */
export const monthSummaryResponseSchema = z.object({
  month: monthKeySchema,
  /** Account creation in the user's zone. The client's back-arrow stops here. */
  earliestLocalDate: localDateSchema,
  days: z.array(monthDaySchema),
  stats: monthStatsSchema,
});
export type MonthSummaryResponse = z.infer<typeof monthSummaryResponseSchema>;
