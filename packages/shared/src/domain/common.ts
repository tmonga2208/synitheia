import { z } from 'zod';
import { isLocalDate } from '../time/local-date.js';
import { isValidTimeZone } from '../time/local-date.js';
import { CURRENCIES } from '../money/money.js';

/** A Mongo ObjectId, serialized. */
export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex id');

/**
 * An id the app chose for something it creates. Something made offline gets its id on the
 * phone, so it can be ticked, edited or deleted before it reaches the server; the server
 * keeps that id. Added to create routes only (`createXSchema.and(clientIdSchema)`), never
 * to update schemas, which are partials of the create ones and must not move an `_id`.
 */
export const clientIdSchema = z.object({ id: objectIdSchema.optional() });
export type ClientId = z.infer<typeof clientIdSchema>;

export const localDateSchema = z
  .string()
  .refine(isLocalDate, 'Expected a calendar date as YYYY-MM-DD');

export const monthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, 'Expected an IANA timezone identifier, e.g. Asia/Kolkata');

export const currencySchema = z.enum(
  Object.keys(CURRENCIES) as [string, ...string[]],
);

/** Money on the wire is always an integer count of minor units. See money.ts. */
export const minorAmountSchema = z
  .number()
  .int('Money must be an integer count of minor units (paise/cents), never a float')
  .safe();

export const isoInstantSchema = z.coerce.date();

/** Wall-clock time of day as HH:mm, e.g. the "07:30 PM" reminder in the design. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time of day as HH:mm (24-hour)');

/**
 * How certain we are that an inferred fact is true, in [0, 1].
 *
 * Anything below CONFIRM_THRESHOLD is never surfaced at all — showing a user a
 * coin-flip guess erodes trust faster than showing them nothing. Nothing, at any
 * confidence, is written without the user confirming it.
 */
export const confidenceSchema = z.number().min(0).max(1);

export const SUGGEST_THRESHOLD = 0.6;

/**
 * Where a piece of data came from. This is a first-class field on every record,
 * not metadata: the UI must always be able to tell the user whether they typed
 * something or the system guessed it, and the AI layer must be able to weight
 * a confirmed manual entry above an inferred one.
 */
export const dataSourceSchema = z.enum([
  'manual', //  the user typed it
  'inferred', //  a rule-based detector proposed it and the user confirmed
  'import_csv', //  bank/card statement upload
  'import_pdf', //  statement PDF
  'import_screenshot', //  payment screenshot shared into the app
  'import_text', //  transaction SMS/notification text pasted or shared in
  'health', //  Apple HealthKit / Android Health Connect
  'calendar', //  device calendar
  'location', //  geofence / visit detection
  'weather', //  weather provider
  'reminder', //  user acted on a reminder
  'subscription', //  a recurring bill the user declared, posted on its due date
]);
export type DataSource = z.infer<typeof dataSourceSchema>;

/** Sources the user can connect, disconnect, and inspect on the Connected Context screen. */
export const connectableSourceSchema = z.enum([
  'health',
  'calendar',
  'location',
  'weather',
  'notifications',
]);
export type ConnectableSource = z.infer<typeof connectableSourceSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
