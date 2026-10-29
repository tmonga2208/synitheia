import { z } from 'zod';
import {
  confidenceSchema,
  dataSourceSchema,
  isoInstantSchema,
  localDateSchema,
  minorAmountSchema,
  objectIdSchema,
  timeZoneSchema,
} from './common.js';

/**
 * The normalized activity vocabulary. Everything that happens in a user's day
 * becomes exactly one of these, regardless of which tracker or sensor produced it.
 *
 * This is a *projection*, not a source of truth. An Expense document remains the
 * authority on an expense; the `expense.created` event exists so that the Today
 * timeline, the daily aggregator, and the AI context builder can read one uniform
 * stream instead of joining nine collections. Domain records stay strongly modeled.
 */
export const eventTypeSchema = z.enum([
  'expense.created',
  'expense.detected',
  'habit.completed',
  'habit.missed',
  'food.logged',
  'water.logged',
  'workout.detected',
  'steps.recorded',
  'sleep.detected',
  'location.arrived',
  'location.departed',
  'calendar.started',
  'calendar.completed',
  'reminder.completed',
  'weather.observed',
  'weight.logged',
]);
export type EventType = z.infer<typeof eventTypeSchema>;

/**
 * Per-type payloads. Discriminated on `type` so that consumers get exact typing
 * rather than a `Record<string, unknown>` bag — the aggregator and AI context
 * builder both read these fields by name and must not guess at their shape.
 */
export const eventMetadataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('expense.created'),
    amountMinor: minorAmountSchema,
    currency: z.string(),
    categoryName: z.string(),
    categoryColor: z.string(),
    merchant: z.string().nullable(),
    note: z.string().nullable(),
  }),
  z.object({
    type: z.literal('expense.detected'),
    amountMinor: minorAmountSchema,
    currency: z.string(),
    merchant: z.string().nullable(),
    rawText: z.string().nullable(),
  }),
  z.object({
    type: z.literal('habit.completed'),
    habitId: objectIdSchema,
    habitName: z.string(),
    habitColor: z.string(),
    count: z.number().int().nonnegative(),
    targetCount: z.number().int().positive(),
    streakAfter: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('habit.missed'),
    habitId: objectIdSchema,
    habitName: z.string(),
    streakBroken: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('food.logged'),
    foodName: z.string(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
    calories: z.number().nonnegative(),
    proteinG: z.number().nonnegative(),
    carbsG: z.number().nonnegative(),
    fatG: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('weight.logged'),
    weightKg: z.number().positive(),
  }),
  z.object({
    type: z.literal('water.logged'),
    amountMl: z.number().int().positive(),
    totalMlToday: z.number().int().nonnegative(),
    targetMl: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('workout.detected'),
    activity: z.string(),
    durationMin: z.number().nonnegative(),
    calories: z.number().nonnegative().nullable(),
  }),
  z.object({
    type: z.literal('steps.recorded'),
    steps: z.number().int().nonnegative(),
    distanceM: z.number().nonnegative().nullable(),
  }),
  z.object({
    type: z.literal('sleep.detected'),
    durationMin: z.number().nonnegative(),
    startedAt: isoInstantSchema,
    endedAt: isoInstantSchema,
  }),
  z.object({
    type: z.literal('location.arrived'),
    placeLabel: z.string().nullable(),
    placeId: z.string().nullable(),
  }),
  z.object({
    type: z.literal('location.departed'),
    placeLabel: z.string().nullable(),
    placeId: z.string().nullable(),
    dwellMin: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('calendar.started'),
    title: z.string(),
    durationMin: z.number().nonnegative(),
    isAllDay: z.boolean(),
  }),
  z.object({
    type: z.literal('calendar.completed'),
    title: z.string(),
    durationMin: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal('reminder.completed'),
    reminderId: objectIdSchema,
    label: z.string(),
  }),
  z.object({
    type: z.literal('weather.observed'),
    conditionCode: z.string(),
    tempC: z.number(),
  }),
]);
export type EventMetadata = z.infer<typeof eventMetadataSchema>;

export const personalEventSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  type: eventTypeSchema,
  source: dataSourceSchema,

  /** The UTC instant the thing actually happened (not when we recorded it). */
  timestamp: isoInstantSchema,
  /** The user's timezone at the moment of the event — history stays anchored to where it happened. */
  timezone: timeZoneSchema,
  /** Denormalized from timestamp + timezone at write time. Every day/week query filters on this. */
  localDate: localDateSchema,

  /** 1.0 for anything the user did or confirmed; < 1.0 only for passively detected events. */
  confidence: confidenceSchema,

  /** Points back at the domain document that owns this event, when there is one. */
  refId: objectIdSchema.nullable(),

  /**
   * Stable natural key for this event, unique per user.
   *
   * This is the idempotency guarantee: re-syncing Tuesday's steps, replaying a
   * webhook, or a client retrying a flaky request must never double-log the day.
   * Format: `<source>:<kind>:<stable-discriminator>`, e.g. `health:steps:2026-07-12`
   * or `expense:6871f0...`. A unique index on (userId, dedupeKey) enforces it in
   * the database rather than trusting application code to remember.
   */
  dedupeKey: z.string().min(1),

  metadata: eventMetadataSchema,
  createdAt: isoInstantSchema,
});
export type PersonalEvent = z.infer<typeof personalEventSchema>;

/** What a producer supplies; the engine derives localDate, confidence defaults, and ids. */
export interface EmitEventInput<T extends EventMetadata = EventMetadata> {
  userId: string;
  source: z.infer<typeof dataSourceSchema>;
  timestamp: Date;
  timezone: string;
  metadata: T;
  dedupeKey: string;
  refId?: string | null;
  confidence?: number;
}

/**
 * Events the user performed or explicitly confirmed. These are facts.
 * Passively detected events are inferences, and the UI labels them as such.
 */
const USER_ASSERTED_SOURCES = new Set(['manual', 'reminder', 'inferred']);

export function isUserAsserted(source: z.infer<typeof dataSourceSchema>): boolean {
  return USER_ASSERTED_SOURCES.has(source);
}

/** Human-facing labels for the Today timeline. */
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  'expense.created': 'Expense',
  'expense.detected': 'Possible expense',
  'habit.completed': 'Habit completed',
  'habit.missed': 'Habit missed',
  'food.logged': 'Food',
  'water.logged': 'Water',
  'weight.logged': 'Weight',
  'workout.detected': 'Workout',
  'steps.recorded': 'Steps',
  'sleep.detected': 'Sleep',
  'location.arrived': 'Arrived',
  'location.departed': 'Left',
  'calendar.started': 'Event',
  'calendar.completed': 'Event ended',
  'reminder.completed': 'Reminder',
  'weather.observed': 'Weather',
};
