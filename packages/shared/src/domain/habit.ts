import { z } from 'zod';
import {
  dataSourceSchema,
  isoInstantSchema,
  localDateSchema,
  objectIdSchema,
  timeOfDaySchema,
} from './common.js';

export const habitFrequencySchema = z.enum(['daily', 'weekly']);
export type HabitFrequency = z.infer<typeof habitFrequencySchema>;

/**
 * What a habit actually measures.
 *
 * Everything is still counted in ONE integer (`count` against `targetCount`) — the measure
 * does not add a second number, it only says how to *read* the one that is there. "Walk
 * 8000 steps" and "Read 20 pages" are the same arithmetic; they differ in the unit, the
 * size of a sensible tap, and how the total is written down.
 *
 * Keeping it that way means streaks, completion, and history need no special cases: a habit
 * is done when count >= targetCount, whether that is 1 meditation or 8000 steps.
 */
export const habitMeasureSchema = z.enum(['check', 'count', 'duration', 'steps']);
export type HabitMeasure = z.infer<typeof habitMeasureSchema>;

export interface HabitMeasureSpec {
  label: string;
  /** Default unit. `null` for `check`, which is done-or-not and has nothing to count. */
  unit: string | null;
  defaultTarget: number;
  /** How much one tap on the habit card adds. A step goal moves in 500s, not in 1s. */
  step: number;
  minTarget: number;
  maxTarget: number;
  /** Whether the user may rename the unit ("glasses", "pages", "reps"). */
  customUnit: boolean;
}

export const HABIT_MEASURES: Record<HabitMeasure, HabitMeasureSpec> = {
  check: {
    label: 'Done or not',
    unit: null,
    defaultTarget: 1,
    step: 1,
    minTarget: 1,
    maxTarget: 1,
    customUnit: false,
  },
  count: {
    label: 'Count',
    unit: 'times',
    defaultTarget: 3,
    step: 1,
    minTarget: 1,
    maxTarget: 100,
    customUnit: true,
  },
  duration: {
    label: 'Time',
    unit: 'min',
    defaultTarget: 20,
    step: 5,
    minTarget: 5,
    maxTarget: 1440, // a day
    customUnit: false,
  },
  steps: {
    label: 'Steps',
    unit: 'steps',
    defaultTarget: 8000,
    step: 500,
    minTarget: 500,
    maxTarget: 100_000,
    customUnit: false,
  },
};

/**
 * Mongo does not backfill a schema default onto documents written before the field existed,
 * and `.lean()` reads hand back exactly what is stored — so every habit created before
 * `measure` existed comes back with it `undefined`. Read it through here, never directly.
 */
export function measureOf(habit: { measure?: HabitMeasure | null }): HabitMeasure {
  return habit.measure ?? 'check';
}

/** "8,000 steps" / "20 min" / "3 glasses" / "" for a plain check. */
export function formatHabitTarget(habit: {
  targetCount: number;
  unit?: string | null;
  measure?: HabitMeasure | null;
}): string {
  const measure = measureOf(habit);
  if (measure === 'check') return '';

  const unit = habit.unit ?? HABIT_MEASURES[measure].unit ?? '';
  return `${habit.targetCount.toLocaleString()} ${unit}`.trim();
}

/** "3,500 / 8,000 steps" — the same shape for every measure that counts. */
export function formatHabitProgress(
  habit: { targetCount: number; unit?: string | null; measure?: HabitMeasure | null },
  count: number,
): string {
  const measure = measureOf(habit);
  if (measure === 'check') return '';

  const unit = habit.unit ?? HABIT_MEASURES[measure].unit ?? '';
  return `${count.toLocaleString()} / ${habit.targetCount.toLocaleString()} ${unit}`.trim();
}

/**
 * The per-habit accent colors from the design. Habit cards in the reference are
 * individually tinted (indigo / sage / dusty-rose) — border, icon chip, metadata
 * text, and the completion affordance all pick this up. It is the most distinctive
 * thing in the visual language, so the palette is part of the domain, not the theme.
 */
export const HABIT_COLORS = [
  '#7D927D', //  sage      — the signature
  '#7D8FA9', //  indigo
  '#C08A7D', //  clay
  '#B0917D', //  sand
  '#8A9AA9', //  slate
  '#A98DA9', //  mauve
  '#7DA095', //  teal
  '#B08A8A', //  rose
] as const;

export const habitColorSchema = z.enum(HABIT_COLORS);

export const habitSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,

  name: z.string().min(1).max(60),
  icon: z.string().min(1), //  lucide icon name
  color: habitColorSchema,
  category: z.string().max(40).nullable(),

  frequency: habitFrequencySchema,
  measure: habitMeasureSchema,
  /**
   * How much per period counts as done — 1 meditation, 3 glasses, 20 minutes, 8000 steps.
   *
   * The ceiling is 100_000, not 100. The old cap made a step goal literally unrepresentable,
   * which is why every habit in the app was a checkbox.
   */
  targetCount: z.number().int().min(1).max(100_000),
  /** Unit for anything that counts, e.g. "min", "steps", "pages", "glasses". */
  unit: z.string().max(16).nullable(),

  /** The "Gentle Remainder" time. Null = no reminder. */
  reminderTime: timeOfDaySchema.nullable(),

  /**
   * Cached, never authoritative. HabitLog is the truth; this is recomputed on every
   * write so the habit list can render a streak without scanning the log collection.
   */
  currentStreak: z.number().int().nonnegative(),
  longestStreak: z.number().int().nonnegative(),

  /** Soft-archive. Habits are never hard-deleted — their logs are the user's history. */
  archivedAt: isoInstantSchema.nullable(),

  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});
export type Habit = z.infer<typeof habitSchema>;

export const createHabitSchema = z
  .object({
    name: z.string().min(1).max(60),
    icon: z.string().min(1),
    color: habitColorSchema,
    category: z.string().max(40).nullish(),
    frequency: habitFrequencySchema,
    measure: habitMeasureSchema.default('check'),
    targetCount: z.number().int().min(1).max(100_000).default(1),
    unit: z.string().max(16).nullish(),
    reminderTime: timeOfDaySchema.nullish(),
  })
  .superRefine((habit, ctx) => {
    const spec = HABIT_MEASURES[habit.measure];

    // A check is done or it is not. "Meditate, 7 times, done or not" is not a thing, and
    // allowing it would make the card render a progress bar that can never be right.
    if (habit.measure === 'check' && habit.targetCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetCount'],
        message: 'A done-or-not habit has a target of 1',
      });
    }

    if (habit.targetCount < spec.minTarget || habit.targetCount > spec.maxTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetCount'],
        message: `${spec.label} must be between ${spec.minTarget} and ${spec.maxTarget}`,
      });
    }
  });
export type CreateHabitInput = z.infer<typeof createHabitSchema>;

/**
 * `.innerType()` because the superRefine above wraps the object in a ZodEffects, which has
 * no `.partial()`. The cross-field rules cannot run on a patch anyway — a request that sets
 * only `targetCount` does not carry the `measure` to check it against.
 */
export const updateHabitSchema = createHabitSchema.innerType().partial();
export type UpdateHabitInput = z.infer<typeof updateHabitSchema>;

/**
 * One habit's progress on one local day.
 *
 * The (userId, habitId, localDate) unique index IS the idempotency guarantee — a
 * double-tapped checkbox or a retried request updates the same row rather than
 * inflating the streak. Never rely on application code to remember this.
 */
export const habitLogSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  habitId: objectIdSchema,
  localDate: localDateSchema,
  count: z.number().int().nonnegative(),
  targetCount: z.number().int().positive(),
  completedAt: isoInstantSchema.nullable(),
  source: dataSourceSchema,
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});
export type HabitLog = z.infer<typeof habitLogSchema>;

export function isHabitComplete(log: Pick<HabitLog, 'count' | 'targetCount'>): boolean {
  return log.count >= log.targetCount;
}

export const logHabitSchema = z.object({
  localDate: localDateSchema.optional(),
  /** Absolute count, not a delta — makes the request idempotent under retry. */
  count: z.number().int().nonnegative().optional(),
  /** Convenience for the `+` affordance on the habit card. */
  increment: z.number().int().optional(),
});
export type LogHabitInput = z.infer<typeof logHabitSchema>;
