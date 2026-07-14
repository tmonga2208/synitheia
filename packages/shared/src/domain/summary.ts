import { z } from 'zod';
import {
  connectableSourceSchema,
  isoInstantSchema,
  localDateSchema,
  minorAmountSchema,
  objectIdSchema,
} from './common.js';
import { macrosSchema } from './nutrition.js';

/**
 * The deterministic rollup of one day. Everything here is computed in application
 * code — sums, rates, counts. The LLM never calculates any of it; it only reads it.
 *
 * This document, not the raw collections, is what the AI Context Builder consumes.
 * That is what keeps "do not send the user's entire database to an LLM" structurally
 * true rather than merely intended.
 */
export const dailySummarySchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  localDate: localDateSchema,

  expenses: z.object({
    totalMinor: minorAmountSchema,
    count: z.number().int().nonnegative(),
    byCategory: z.record(z.string(), minorAmountSchema),
    largestMinor: minorAmountSchema.nullable(),
  }),

  habits: z.object({
    scheduled: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    /** completed / scheduled, or 0 when nothing was scheduled. Never NaN. */
    completionRate: z.number().min(0).max(1),
    completedIds: z.array(objectIdSchema),
    missedIds: z.array(objectIdSchema),
  }),

  nutrition: z.object({
    totals: macrosSchema,
    entryCount: z.number().int().nonnegative(),
    calorieTarget: z.number().int().positive(),
  }),

  water: z.object({
    totalMl: z.number().int().nonnegative(),
    targetMl: z.number().int().positive(),
    entryCount: z.number().int().nonnegative(),
  }),

  activity: z.object({
    steps: z.number().int().nonnegative().nullable(),
    workoutMinutes: z.number().nonnegative().nullable(),
    sleepMinutes: z.number().nonnegative().nullable(),
  }),

  context: z.object({
    weekday: z.number().int().min(0).max(6),
    calendarEventCount: z.number().int().nonnegative(),
    /** Minutes past midnight of the last calendar event — powers "days with late meetings". */
    lastCalendarEventEndMin: z.number().int().nullable(),
    weatherCondition: z.string().nullable(),
  }),

  eventCount: z.number().int().nonnegative(),
  /** Which sources contributed. Absent sources mean "not connected", not "zero". */
  sources: z.array(connectableSourceSchema),

  generatedAt: isoInstantSchema,
});
export type DailySummary = z.infer<typeof dailySummarySchema>;

// ─── Data source connections (the privacy ledger) ───────────────────────────

export const connectionStatusSchema = z.enum([
  'connected',
  'denied', //  the OS permission was refused
  'disabled', //  the user turned it off in-app
  'unavailable', //  the platform does not expose it on this device
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

/**
 * Backs the Connected Context screen. This is not a settings row — it is the
 * user's ledger of what we know about them and where it came from. Every collector
 * checks this document at runtime before it reads a single byte; a source that is
 * `disabled` here cannot be read even if the OS permission is still granted.
 */
export const dataSourceConnectionSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,

  source: connectableSourceSchema,
  status: connectionStatusSchema,
  grantedScopes: z.array(z.string()),

  lastSyncedAt: isoInstantSchema.nullable(),
  lastSyncError: z.string().nullable(),
  eventCount: z.number().int().nonnegative(),

  /** Independent of collection. A user may keep a source on but withhold it from AI. */
  aiAllowed: z.boolean(),

  connectedAt: isoInstantSchema.nullable(),
  updatedAt: isoInstantSchema,
});
export type DataSourceConnection = z.infer<typeof dataSourceConnectionSchema>;
