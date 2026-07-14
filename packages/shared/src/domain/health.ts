import { z } from 'zod';
import { isoInstantSchema, localDateSchema } from './common.js';
import type { LocalDate } from '../time/local-date.js';

/**
 * Health.
 *
 * Everything here is READ. Synítheia never writes to Apple Health — a tracker that edits
 * the system health store is a tracker you cannot trust, and there is nothing we could put
 * there that the user did not already tell us.
 *
 * The numbers below are ESTIMATES, and the code says so out loud rather than dressing them
 * up. BMI is a crude ratio that cannot tell muscle from fat. BMR is a population regression
 * with a real error bar on any individual. A calorie target computed from them is a starting
 * point for a conversation, not a prescription — which is exactly why the user confirms it
 * rather than having it silently applied.
 */

export const biologicalSexSchema = z.enum(['male', 'female', 'other']);
export type BiologicalSex = z.infer<typeof biologicalSexSchema>;

/** What we can read about the body. Every field is optional — Health may hold none of it. */
export const bodyMetricsSchema = z.object({
  heightCm: z.number().min(50).max(280).nullable(),
  weightKg: z.number().min(20).max(500).nullable(),
  biologicalSex: biologicalSexSchema.nullable(),
  birthDate: localDateSchema.nullable(),
});
export type BodyMetrics = z.infer<typeof bodyMetricsSchema>;

export const workoutSchema = z.object({
  /** HealthKit's activity name, e.g. "running", "traditionalStrengthTraining". */
  kind: z.string().min(1).max(60),
  minutes: z.number().nonnegative().max(24 * 60),
  energyKcal: z.number().nonnegative().max(20_000).nullable(),
});
export type Workout = z.infer<typeof workoutSchema>;

/**
 * One local day of health, as the device reports it.
 *
 * Deliberately a per-DAY snapshot rather than a stream of samples. The app never needs to
 * know that you took 43 steps at 09:14 — it needs the day's total, on the day's own local
 * calendar, which is the same grain everything else in this app is stored at.
 */
export const healthSnapshotSchema = z.object({
  localDate: localDateSchema,

  steps: z.number().int().nonnegative().max(300_000).nullable(),
  /** Energy burned ABOVE resting. HealthKit's definition — it excludes BMR. */
  activeEnergyKcal: z.number().nonnegative().max(20_000).nullable(),
  exerciseMinutes: z.number().nonnegative().max(24 * 60).nullable(),

  sleepMinutes: z.number().nonnegative().max(24 * 60).nullable(),
  /** The timeline needs a real interval to place sleep, not just a duration. */
  sleepStart: isoInstantSchema.nullable().default(null),
  sleepEnd: isoInstantSchema.nullable().default(null),

  restingHeartRate: z.number().min(20).max(220).nullable(),
  workouts: z.array(workoutSchema).max(30).default([]),
});
export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>;

export const syncHealthSchema = z.object({
  body: bodyMetricsSchema.partial().optional(),
  days: z.array(healthSnapshotSchema).min(1).max(31),
});
export type SyncHealthInput = z.infer<typeof syncHealthSchema>;

// ─── Body maths ──────────────────────────────────────────────────────────────

/** Whole years, floored. Computed in pure UTC, like every other date calculation here. */
export function ageOn(birthDate: LocalDate, on: LocalDate): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [oy, om, od] = on.split('-').map(Number) as [number, number, number];

  let age = oy - by;
  // Birthday has not happened yet this year.
  if (om < bm || (om === bm && od < bd)) age -= 1;

  return Math.max(0, age);
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export type BmiBand = 'underweight' | 'healthy' | 'overweight' | 'obese';

/** The WHO bands. A blunt instrument — it cannot tell muscle from fat, and never could. */
export function bmiBand(value: number): BmiBand {
  if (value < 18.5) return 'underweight';
  if (value < 25) return 'healthy';
  if (value < 30) return 'overweight';
  return 'obese';
}

/**
 * Basal metabolic rate — Mifflin-St Jeor.
 *
 * Chosen over Harris-Benedict because it is measurably more accurate on modern populations.
 * It NEEDS sex and age; there is no honest version without them, which is why the caller
 * gets `null` rather than a plausible number built on a guess. A silently-wrong BMR would
 * propagate into a calorie target the user then eats to.
 *
 * For 'other', the two sex constants are averaged. That is a compromise, not a truth, and
 * the UI says the estimate is rougher in that case.
 */
export function bmr(metrics: {
  weightKg: number;
  heightCm: number;
  biologicalSex: BiologicalSex;
  age: number;
}): number {
  const { weightKg, heightCm, biologicalSex, age } = metrics;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;

  const offset = biologicalSex === 'male' ? 5 : biologicalSex === 'female' ? -161 : (5 - 161) / 2;

  return Math.round(base + offset);
}

/**
 * How much you actually burn in a day.
 *
 * Two routes, and the MEASURED one wins whenever it exists:
 *
 *   1. Apple Health already knows your active energy — energy burned above resting. Then
 *      TDEE is simply BMR + that. No guessing at a lifestyle bracket.
 *   2. With no active-energy reading, fall back to a step-derived activity multiplier. It is
 *      cruder, and `estimated` says so, so the UI can be honest about which one it used.
 */
export interface Tdee {
  kcal: number;
  /** True when we had to fall back to a multiplier instead of measured energy. */
  estimated: boolean;
}

export function activityFactorFromSteps(steps: number): number {
  if (steps < 5_000) return 1.2; //  sedentary
  if (steps < 7_500) return 1.375; //  lightly active
  if (steps < 10_000) return 1.55; //  moderately active
  if (steps < 12_500) return 1.725; //  active
  return 1.9; //  very active
}

export function tdee(
  basal: number,
  day: { activeEnergyKcal?: number | null; steps?: number | null },
): Tdee {
  if (day.activeEnergyKcal != null && day.activeEnergyKcal > 0) {
    return { kcal: Math.round(basal + day.activeEnergyKcal), estimated: false };
  }

  const factor = activityFactorFromSteps(day.steps ?? 0);
  return { kcal: Math.round(basal * factor), estimated: true };
}

// ─── Calorie target ──────────────────────────────────────────────────────────

export const calorieGoalSchema = z.enum(['lose', 'maintain', 'gain']);
export type CalorieGoal = z.infer<typeof calorieGoalSchema>;

/** ~0.5 kg/week, the rate most guidance considers sustainable. */
const DEFICIT_KCAL = 500;
const SURPLUS_KCAL = 300;

/**
 * Floors, and why they are not negotiable.
 *
 * A deficit applied to a small person with a sedentary day can arithmetically land under
 * 1,000 kcal. The maths would be "correct" and the advice would be harmful. The target is
 * therefore never allowed below these floors, and never below BMR — you should not be eating
 * less than the energy required to keep you alive at rest.
 */
const FLOOR_KCAL: Record<BiologicalSex, number> = {
  female: 1200,
  male: 1500,
  other: 1200,
};

export interface CalorieTarget {
  kcal: number;
  maintenanceKcal: number;
  /** True when a floor clamped the number, so the UI can explain why it is not TDEE − 500. */
  floored: boolean;
}

export function calorieTargetFor(
  maintenance: number,
  goal: CalorieGoal,
  opts: { basal: number; biologicalSex: BiologicalSex },
): CalorieTarget {
  const raw =
    goal === 'lose'
      ? maintenance - DEFICIT_KCAL
      : goal === 'gain'
        ? maintenance + SURPLUS_KCAL
        : maintenance;

  const floor = Math.max(FLOOR_KCAL[opts.biologicalSex], opts.basal);
  const kcal = Math.max(raw, floor);

  return {
    kcal: Math.round(kcal),
    maintenanceKcal: Math.round(maintenance),
    floored: kcal > raw,
  };
}

// ─── The whole picture ───────────────────────────────────────────────────────

export interface BodyInsight {
  bmi: number | null;
  bmiBand: BmiBand | null;
  bmrKcal: number | null;
  tdee: Tdee | null;
  /** What we still need before the calorie maths can run at all. */
  missing: ('height' | 'weight' | 'sex' | 'birthDate')[];
}

/**
 * Everything derivable from the body, or an honest account of what is missing.
 *
 * Returns `missing` rather than filling gaps with population averages. A calorie target
 * built on an assumed height is not an estimate, it is a fabrication that looks like one.
 */
export function bodyInsight(
  body: BodyMetrics,
  day: { activeEnergyKcal?: number | null; steps?: number | null },
  today: LocalDate,
): BodyInsight {
  const missing: BodyInsight['missing'] = [];
  if (body.heightCm == null) missing.push('height');
  if (body.weightKg == null) missing.push('weight');
  if (body.biologicalSex == null) missing.push('sex');
  if (body.birthDate == null) missing.push('birthDate');

  // BMI needs only height and weight, so it can exist even when BMR cannot.
  const bmiValue =
    body.heightCm != null && body.weightKg != null ? bmi(body.weightKg, body.heightCm) : null;

  if (
    body.heightCm == null ||
    body.weightKg == null ||
    body.biologicalSex == null ||
    body.birthDate == null
  ) {
    return {
      bmi: bmiValue,
      bmiBand: bmiValue == null ? null : bmiBand(bmiValue),
      bmrKcal: null,
      tdee: null,
      missing,
    };
  }

  const basal = bmr({
    weightKg: body.weightKg,
    heightCm: body.heightCm,
    biologicalSex: body.biologicalSex,
    age: ageOn(body.birthDate, today),
  });

  return {
    bmi: bmiValue,
    bmiBand: bmiValue == null ? null : bmiBand(bmiValue),
    bmrKcal: basal,
    tdee: tdee(basal, day),
    missing,
  };
}
