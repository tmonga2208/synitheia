import { z } from 'zod';
import { localDateSchema, minorAmountSchema } from './common.js';
import { habitSchema } from './habit.js';
import { inferredContextSchema } from './inference.js';
import { aiInsightSchema } from './insight.js';
import { macrosSchema } from './nutrition.js';
import { personalEventSchema } from './personal-event.js';

/**
 * Everything the Today screen needs, in one request.
 *
 * The home screen is the product. It must paint in a single round trip — a user
 * opening the app to five spinners resolving at different times feels like five
 * trackers stitched together, which is exactly the feeling the brief forbids.
 *
 * Progressive disclosure lives here too: this payload is deliberately shallow. Ring,
 * chips, today's habits, today's totals, the timeline, and any pending suggestions.
 * Detail (the full expense list, every food entry) is fetched only when the user
 * intentionally opens that tracker.
 */
export const todayResponseSchema = z.object({
  localDate: localDateSchema,
  greeting: z.string(), //  "Good morning" / "Good afternoon" / "Good evening"

  /** The big ring. Composite of every tracker the user actually uses. */
  dailyFlow: z.object({
    percent: z.number().int().min(0).max(100),
    /** What went into the ring, so the UI can explain the number if asked. */
    components: z.array(
      z.object({
        key: z.enum(['habits', 'water', 'nutrition']),
        percent: z.number().int().min(0).max(100),
        weight: z.number().min(0).max(1),
      }),
    ),
  }),

  /** The two pill chips beneath the ring. */
  streakDays: z.number().int().nonnegative(),
  xp: z.number().int().nonnegative(),

  habits: z.array(
    habitSchema.extend({
      todayCount: z.number().int().nonnegative(),
      todayComplete: z.boolean(),
    }),
  ),

  expenses: z.object({
    totalMinor: minorAmountSchema,
    count: z.number().int().nonnegative(),
    budgetRemainingMinor: minorAmountSchema.nullable(),
  }),

  nutrition: z.object({
    totals: macrosSchema,
    calorieTarget: z.number().int().positive(),
  }),

  water: z.object({
    totalMl: z.number().int().nonnegative(),
    targetMl: z.number().int().positive(),
  }),

  /** The contextual rail: what actually happened today, in order. */
  timeline: z.array(personalEventSchema),

  /** "Looks like you had lunch around 1:15 PM. Add it to today?" */
  suggestions: z.array(inferredContextSchema),

  /** At most one insight surfaces on Today. The rest live in the Insights tab. */
  featuredInsight: aiInsightSchema.nullable(),

  /** Monday-anchored, for the Weekly Analysis chart. Index 0 = Monday. */
  weeklyFlow: z.array(
    z.object({
      localDate: localDateSchema,
      percent: z.number().int().min(0).max(100),
      isToday: z.boolean(),
    }),
  ),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;

export const timelineQuerySchema = z.object({
  localDate: localDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/**
 * The composite "Daily Flow" percentage.
 *
 * Only trackers the user actually uses are counted. Someone who tracks habits and
 * water but never logs food should be able to hit 100%, not be permanently capped
 * at 67% by a tracker they have never opened. A ring that cannot reach 100% is a
 * ring that quietly tells the user they are failing.
 */
export interface FlowComponent {
  key: 'habits' | 'water' | 'nutrition';
  percent: number;
  /** False when the user has no habits / no calorie target / has never logged food. */
  active: boolean;
}

export function computeDailyFlow(components: readonly FlowComponent[]): {
  percent: number;
  components: { key: FlowComponent['key']; percent: number; weight: number }[];
} {
  const active = components.filter((c) => c.active);
  if (active.length === 0) return { percent: 0, components: [] };

  const weight = 1 / active.length;
  const percent = Math.round(
    active.reduce((acc, c) => acc + Math.min(100, Math.max(0, c.percent)) * weight, 0),
  );

  return {
    percent: Math.min(100, Math.max(0, percent)),
    components: active.map((c) => ({
      key: c.key,
      percent: Math.min(100, Math.max(0, Math.round(c.percent))),
      weight,
    })),
  };
}

export function greetingFor(minutesOfDay: number): string {
  if (minutesOfDay < 12 * 60) return 'Good morning';
  if (minutesOfDay < 17 * 60) return 'Good afternoon';
  return 'Good evening';
}
