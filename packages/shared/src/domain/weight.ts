import { z } from 'zod';
import { localDateSchema } from './common.js';
import type { LocalDate } from '../time/local-date.js';
import {
  bmr,
  calorieTargetFor,
  type BiologicalSex,
  type CalorieGoal,
  type CalorieTarget,
} from './health.js';

/**
 * Weight check-ins: one weight per day, typed in or read from Health.
 *
 * They are what keeps the Body screen useful after the first visit: the trend says whether
 * the calorie goal is working, and the target follows the weight instead of staying frozen
 * at whatever it was on the day the goal was picked.
 */

export const weightSourceSchema = z.enum(['manual', 'health']);
export type WeightSource = z.infer<typeof weightSourceSchema>;

export const logWeightSchema = z.object({
  weightKg: z.number().min(20).max(500),
  /** Defaults to today in the user's zone. */
  localDate: localDateSchema.optional(),
});
export type LogWeightInput = z.infer<typeof logWeightSchema>;

export interface WeightPoint {
  localDate: LocalDate;
  weightKg: number;
}

const DAY_MS = 86_400_000;
const daysBetween = (a: LocalDate, b: LocalDate) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** A daily weight swings by a kilo with water alone, so anything closer than this is noise. */
const MIN_SPAN_DAYS = 5;
const MAX_SPAN_DAYS = 21;

/**
 * Kilos per week, from the latest weight and the one closest to a week before it. Null when
 * there is no weight 5–21 days older to compare with: a rate from two days apart would
 * mostly measure what was eaten the night before.
 */
export function weeklyChangeKg(points: WeightPoint[]): number | null {
  const sorted = [...points].sort((a, b) => a.localDate.localeCompare(b.localDate));
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;

  let best: { point: WeightPoint; span: number } | null = null;
  for (const point of sorted) {
    const span = daysBetween(point.localDate, latest.localDate);
    if (span < MIN_SPAN_DAYS || span > MAX_SPAN_DAYS) continue;
    if (!best || Math.abs(span - 7) < Math.abs(best.span - 7)) best = { point, span };
  }
  if (!best) return null;

  const perWeek = ((latest.weightKg - best.point.weightKg) / best.span) * 7;
  return Math.round(perWeek * 10) / 10 || 0;
}

/**
 * How the trend sits against the goal. `lose` aims at about 0.5 kg a week and `gain` at about
 * 0.3; faster than a kilo a week of loss is flagged, because that is more than most guidance
 * considers safe to sustain.
 */
export type GoalPace = 'on_track' | 'fast' | 'steady' | 'opposite' | 'drifting';

export function goalPace(goal: CalorieGoal, perWeekKg: number): GoalPace {
  if (goal === 'maintain') return Math.abs(perWeekKg) < 0.5 ? 'on_track' : 'drifting';

  // Positive when moving the way the goal wants.
  const toward = goal === 'lose' ? -perWeekKg : perWeekKg;
  if (toward >= 1) return 'fast';
  if (toward >= (goal === 'lose' ? 0.2 : 0.1)) return 'on_track';
  if (toward > -0.2) return 'steady';
  return 'opposite';
}

/**
 * The calorie target after the weight moves.
 *
 * Maintenance scales with resting burn, which is what a weight change actually alters; the
 * activity level the user had when they picked the goal is kept as it was. Re-running the goal
 * on today's steps instead would let a quiet morning move the target, which has nothing to do
 * with the weight.
 */
export function retargetForWeight(input: {
  goal: CalorieGoal;
  maintenanceKcal: number;
  fromKg: number;
  toKg: number;
  heightCm: number;
  biologicalSex: BiologicalSex;
  age: number;
}): { maintenanceKcal: number; target: CalorieTarget } {
  const { heightCm, biologicalSex, age } = input;
  const before = bmr({ weightKg: input.fromKg, heightCm, biologicalSex, age });
  const after = bmr({ weightKg: input.toKg, heightCm, biologicalSex, age });

  const maintenanceKcal = Math.round((input.maintenanceKcal * after) / before);
  const target = calorieTargetFor(maintenanceKcal, input.goal, { basal: after, biologicalSex });
  return { maintenanceKcal, target };
}
