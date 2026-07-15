import { z } from 'zod';
import { isoInstantSchema, localDateSchema } from './common.js';

/**
 * Calendar events the phone hands us.
 *
 * Read-only, always. The device is the source of truth; we take a window of events and
 * mirror them onto the timeline so the day has structure — "you had three meetings" — and
 * so patterns like "workouts get skipped on days with late meetings" become observable.
 *
 * `externalId` is the device's own event id and is what makes a re-sync idempotent: the same
 * meeting synced twice updates one timeline row instead of stacking a duplicate. Nothing here
 * is a title we invented — an event with no title is carried as empty and shown as "Busy",
 * never guessed at.
 */
export const calendarEventInputSchema = z.object({
  /** The device-local event identifier. Stable across syncs; the dedupe anchor. */
  externalId: z.string().min(1).max(300),
  title: z.string().max(300),
  startsAt: isoInstantSchema,
  endsAt: isoInstantSchema,
  isAllDay: z.boolean(),
  /** The local day the event starts on, computed on the device where the zone is known. */
  localDate: localDateSchema,
});
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

export const syncCalendarSchema = z.object({
  events: z.array(calendarEventInputSchema).max(500),
});
export type SyncCalendarInput = z.infer<typeof syncCalendarSchema>;
