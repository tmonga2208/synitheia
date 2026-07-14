import { z } from 'zod';
import {
  confidenceSchema,
  isoInstantSchema,
  localDateSchema,
  minorAmountSchema,
  objectIdSchema,
} from './common.js';
import { mealTypeSchema } from './nutrition.js';

/**
 * The contract of the inference system, in one line:
 *
 *     Detect → Infer → Suggest → Confirm
 *
 * NOT: Detect → Silently Assume.
 *
 * Nothing in this file ever writes a domain record. An InferredContext is a
 * *question* the app asks the user ("Looks like you had lunch around 1:15pm — add
 * it?"). Only the user's confirmation writes an Expense or a FoodEntry. Detectors
 * are deterministic rules over PersonalEvents — an LLM is never in this loop,
 * because a hallucinated meal written into someone's calorie log is a real harm.
 */

export const inferenceTypeSchema = z.enum([
  'possible_meal',
  'possible_expense',
  'possible_workout',
  'possible_habit_completion',
  'unusual_spending',
  'missed_habit',
  'low_water',
]);
export type InferenceType = z.infer<typeof inferenceTypeSchema>;

export const inferenceStatusSchema = z.enum([
  'pending', //  shown to the user as a suggestion card
  'confirmed', //  the user accepted; a domain record was written
  'rejected', //  the user said no; feeds back into detector thresholds
  'expired', //  the user ignored it long enough that asking again would be noise
]);
export type InferenceStatus = z.infer<typeof inferenceStatusSchema>;

/** What we would create if the user says yes. Typed per inference, not a loose bag. */
export const proposedPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('food'),
    name: z.string(),
    mealType: mealTypeSchema,
    estimatedCalories: z.number().nonnegative().nullable(),
  }),
  z.object({
    kind: z.literal('expense'),
    amountMinor: minorAmountSchema,
    currency: z.string(),
    merchant: z.string().nullable(),
    suggestedCategoryName: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('habit'),
    habitId: objectIdSchema,
    count: z.number().int().positive(),
  }),
  /** Observations, not proposals — there is nothing to write, only something to notice. */
  z.object({ kind: z.literal('observation') }),
]);
export type ProposedPayload = z.infer<typeof proposedPayloadSchema>;

/**
 * One piece of evidence behind a suggestion, in language the user can check.
 * This is what powers "Why am I seeing this?" — the reasoning must be legible,
 * not a black box, or the user has no basis to trust or correct it.
 */
export const evidenceSchema = z.object({
  eventId: objectIdSchema.nullable(),
  label: z.string(), //  e.g. "₹250 spent at 1:04 PM"
  weight: z.number().min(0).max(1),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const inferredContextSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,

  type: inferenceTypeSchema,
  confidence: confidenceSchema,
  /** Which detector produced this, so a misbehaving rule can be traced and tuned. */
  detector: z.string(),

  title: z.string(), //  "Looks like you had lunch around 1:15 PM"
  description: z.string().nullable(),

  supportingEventIds: z.array(objectIdSchema),
  evidence: z.array(evidenceSchema),
  proposed: proposedPayloadSchema,

  status: inferenceStatusSchema,
  localDate: localDateSchema,

  /**
   * Pending suggestions expire. A stale "did you have lunch?" card from four days
   * ago is noise, and a pile of them is precisely the cluttered dashboard the
   * product brief forbids.
   */
  expiresAt: isoInstantSchema,
  resolvedAt: isoInstantSchema.nullable(),

  /**
   * What the user changed when they corrected us. A rejection tells us the rule
   * misfired; a correction tells us *how*, which is far more useful.
   */
  correction: z
    .object({
      field: z.string(),
      from: z.string(),
      to: z.string(),
    })
    .nullable(),

  createdAt: isoInstantSchema,
});
export type InferredContext = z.infer<typeof inferredContextSchema>;

export const resolveInferenceSchema = z.object({
  action: z.enum(['confirm', 'reject']),
  /** Optional user edits applied before the domain record is written. */
  corrections: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type ResolveInferenceInput = z.infer<typeof resolveInferenceSchema>;
