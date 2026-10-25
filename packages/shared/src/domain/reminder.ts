import { z } from 'zod';
import { isoInstantSchema, objectIdSchema, timeOfDaySchema } from './common.js';

export const reminderKindSchema = z.enum(['habit', 'water', 'food', 'expense', 'custom']);
export type ReminderKind = z.infer<typeof reminderKindSchema>;

/**
 * How a reminder repeats.
 *
 * - `daily`    — fires at a fixed `time` on `weekdays` (or every day). The original mode.
 * - `interval` — fires every `intervalMinutes`, either all day or within an active window.
 */
export const reminderRepeatSchema = z.enum(['daily', 'interval']);
export type ReminderRepeat = z.infer<typeof reminderRepeatSchema>;

/** The shortest interval we allow. Anything tighter is nagging, not nudging. */
export const MIN_INTERVAL_MINUTES = 5;
/** A day. An interval longer than this is really a daily reminder. */
export const MAX_INTERVAL_MINUTES = 1440;

/**
 * The most `DAILY` triggers a single active-hours interval reminder may expand into.
 *
 * iOS caps the whole app at 64 pending notifications; keeping any one reminder well
 * under that leaves room for the user's other reminders. 15m needs a ≤6h window,
 * 30m fits a 12h day, 1h+ fits any window.
 */
export const MAX_INTERVAL_SLOTS = 24;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/**
 * The HH:mm slots an active-hours interval reminder fires at: from `windowStart`
 * (inclusive) stepping by `intervalMinutes`, up to and including `windowEnd`.
 *
 * Windows never wrap past midnight — an end at or before the start yields the single
 * start slot, which the schema's validation forbids anyway.
 */
export function slotTimes(
  windowStart: string,
  windowEnd: string,
  intervalMinutes: number,
): string[] {
  const start = toMinutes(windowStart);
  const end = toMinutes(windowEnd);

  const slots: string[] = [];
  for (let m = start; m <= end; m += intervalMinutes) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

/** How many `DAILY` triggers an active-hours interval reminder would need. */
export function slotCount(
  windowStart: string,
  windowEnd: string,
  intervalMinutes: number,
): number {
  return slotTimes(windowStart, windowEnd, intervalMinutes).length;
}

export const reminderSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,

  kind: reminderKindSchema,
  /** The habit this reminds about, when kind === 'habit'. */
  refId: objectIdSchema.nullable(),

  label: z.string().min(1).max(80),

  repeat: reminderRepeatSchema,

  /** Fixed fire time, for `daily`. Null for `interval` reminders. */
  time: timeOfDaySchema.nullable(),
  /** 0 = Monday … 6 = Sunday. Empty means every day. Only used by `daily`. */
  weekdays: z.array(z.number().int().min(0).max(6)),

  /** Minutes between fires, for `interval`. Null for `daily` reminders. */
  intervalMinutes: z.number().int().min(MIN_INTERVAL_MINUTES).max(MAX_INTERVAL_MINUTES).nullable(),
  /** Active-hours window for `interval`. Both null = all day; both set = windowed. */
  windowStart: timeOfDaySchema.nullable(),
  windowEnd: timeOfDaySchema.nullable(),

  enabled: z.boolean(),

  lastFiredAt: isoInstantSchema.nullable(),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});
export type Reminder = z.infer<typeof reminderSchema>;

/**
 * Cross-field rules shared by create and update. Kept in one place so the client and
 * server agree on what a valid reminder is — a mismatch would let the app schedule a
 * notification the server never accepted, or reject one it did.
 */
function refineReminder(
  value: {
    repeat?: ReminderRepeat;
    time?: string | null;
    intervalMinutes?: number | null;
    windowStart?: string | null;
    windowEnd?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.repeat === 'interval') {
    if (value.intervalMinutes == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intervalMinutes'],
        message: 'Interval reminders need an interval.',
      });
    }

    const startSet = value.windowStart != null;
    const endSet = value.windowEnd != null;
    if (startSet !== endSet) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEnd'],
        message: 'Set both a start and an end time, or neither.',
      });
    } else if (startSet && endSet) {
      if (toMinutes(value.windowStart as string) >= toMinutes(value.windowEnd as string)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['windowEnd'],
          message: 'The window must end after it starts.',
        });
      } else if (value.intervalMinutes != null) {
        const count = slotCount(
          value.windowStart as string,
          value.windowEnd as string,
          value.intervalMinutes,
        );
        if (count > MAX_INTERVAL_SLOTS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['intervalMinutes'],
            message: 'Too many nudges — widen the interval or narrow the window.',
          });
        }
      }
    }
  } else {
    // daily
    if (value.time == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['time'],
        message: 'Daily reminders need a time.',
      });
    }
  }
}

export const createReminderSchema = z
  .object({
    kind: reminderKindSchema,
    refId: objectIdSchema.nullish(),
    label: z.string().min(1).max(80),

    repeat: reminderRepeatSchema.default('daily'),

    time: timeOfDaySchema.nullish(),
    weekdays: z.array(z.number().int().min(0).max(6)).default([]),

    intervalMinutes: z
      .number()
      .int()
      .min(MIN_INTERVAL_MINUTES)
      .max(MAX_INTERVAL_MINUTES)
      .nullish(),
    windowStart: timeOfDaySchema.nullish(),
    windowEnd: timeOfDaySchema.nullish(),

    enabled: z.boolean().default(true),
  })
  .superRefine(refineReminder);
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

export const updateReminderSchema = z
  .object({
    kind: reminderKindSchema.optional(),
    refId: objectIdSchema.nullish(),
    label: z.string().min(1).max(80).optional(),

    repeat: reminderRepeatSchema.optional(),

    time: timeOfDaySchema.nullish(),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),

    intervalMinutes: z
      .number()
      .int()
      .min(MIN_INTERVAL_MINUTES)
      .max(MAX_INTERVAL_MINUTES)
      .nullish(),
    windowStart: timeOfDaySchema.nullish(),
    windowEnd: timeOfDaySchema.nullish(),

    enabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    // Only validate the mode's shape when the mode itself is part of the patch —
    // a bare `{ enabled: false }` toggle must not require resending time/interval.
    if (value.repeat !== undefined) refineReminder(value, ctx);
  });
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;
