import { z } from 'zod';
import { isoInstantSchema, localDateSchema } from './common.js';

/**
 * Places the phone recognises you at.
 *
 * This is best-effort and foreground by design. The app never asks for "always" location —
 * so it notices where you are while you have it open, and deliberately misses visits while
 * it's closed. That is the honest limit Connected Context states, and it is the right trade:
 * a background tracker running all day to catch every visit is exactly the surveillance this
 * product refuses to be.
 *
 * `placeId` is a coarse, rounded coordinate — stable enough to recognise "here again" and
 * too coarse to be an address. `placeLabel` is whatever the OS reverse-geocode named the
 * area ("Connaught Place"), never something inferred about why you were there.
 */
export const placeVisitSchema = z.object({
  /** A stable, coarse id for the place — a rounded coordinate, not an address. */
  placeId: z.string().min(1).max(120),
  placeLabel: z.string().max(200),
  arrivedAt: isoInstantSchema,
  localDate: localDateSchema,
});
export type PlaceVisit = z.infer<typeof placeVisitSchema>;

export const syncLocationSchema = z.object({
  visits: z.array(placeVisitSchema).max(100),
});
export type SyncLocationInput = z.infer<typeof syncLocationSchema>;
