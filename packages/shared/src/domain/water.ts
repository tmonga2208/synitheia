import { z } from 'zod';
import {
  dataSourceSchema,
  isoInstantSchema,
  localDateSchema,
  objectIdSchema,
  timeZoneSchema,
} from './common.js';

export const waterEntrySchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  amountMl: z.number().int().positive().max(5000),
  loggedAt: isoInstantSchema,
  timezone: timeZoneSchema,
  localDate: localDateSchema,
  source: dataSourceSchema,
  createdAt: isoInstantSchema,
});
export type WaterEntry = z.infer<typeof waterEntrySchema>;

export const createWaterEntrySchema = z.object({
  amountMl: z.number().int().positive().max(5000),
  loggedAt: isoInstantSchema.optional(),
  /**
   * Client-generated idempotency key. Water is logged by tapping a glass icon, which
   * users double-tap and which fires on a flaky mobile connection — without this, a
   * retry silently double-logs 500ml.
   */
  clientKey: z.string().min(8).max(64).optional(),
});
export type CreateWaterEntryInput = z.infer<typeof createWaterEntrySchema>;

/** The quick-add presets on the water ring. */
export const WATER_PRESETS_ML = [200, 300, 500, 750] as const;

/**
 * An amount of water as people say it: "750 ml" under a litre, "1.25 L" from one.
 *
 * The one way the app writes water. The ring, the timeline, the reminders and the
 * insights each used to write it their own way ("1250", "2,500 ml", "1.2 L").
 */
export function formatVolume(ml: number): string {
  if (ml < 1000) return `${Math.round(ml)} ml`;
  // Two decimals at most; converting back to a number drops the trailing zeros.
  return `${Math.round(ml / 10) / 100} L`;
}
