import { z } from 'zod';
import { isoInstantSchema, objectIdSchema, timeOfDaySchema } from './common.js';

export const reminderKindSchema = z.enum(['habit', 'water', 'food', 'expense', 'custom']);
export type ReminderKind = z.infer<typeof reminderKindSchema>;

export const reminderSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,

  kind: reminderKindSchema,
  /** The habit this reminds about, when kind === 'habit'. */
  refId: objectIdSchema.nullable(),

  label: z.string().min(1).max(80),
  time: timeOfDaySchema,
  /** 0 = Monday … 6 = Sunday. Empty means every day. */
  weekdays: z.array(z.number().int().min(0).max(6)),
  enabled: z.boolean(),

  lastFiredAt: isoInstantSchema.nullable(),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});
export type Reminder = z.infer<typeof reminderSchema>;

export const createReminderSchema = z.object({
  kind: reminderKindSchema,
  refId: objectIdSchema.nullish(),
  label: z.string().min(1).max(80),
  time: timeOfDaySchema,
  weekdays: z.array(z.number().int().min(0).max(6)).default([]),
  enabled: z.boolean().default(true),
});
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

export const updateReminderSchema = createReminderSchema.partial();
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;
