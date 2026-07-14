import { z } from 'zod';
import {
  confidenceSchema,
  dataSourceSchema,
  isoInstantSchema,
  localDateSchema,
  objectIdSchema,
  timeZoneSchema,
} from './common.js';

export const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealType = z.infer<typeof mealTypeSchema>;

export const macrosSchema = z.object({
  calories: z.number().nonnegative().max(20_000),
  proteinG: z.number().nonnegative().max(1000),
  carbsG: z.number().nonnegative().max(1000),
  fatG: z.number().nonnegative().max(1000),
});
export type Macros = z.infer<typeof macrosSchema>;

export const ZERO_MACROS: Macros = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

export const foodEntrySchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,

  name: z.string().min(1).max(120),
  mealType: mealTypeSchema,
  servings: z.number().positive().max(100),

  /**
   * Macros are the totals for `servings`, denormalized at log time.
   *
   * If a food database later revises "1 roti" from 120 to 130 kcal, the user's
   * history must not silently change underneath them — last Tuesday's total is a
   * historical fact, not a live query. So we snapshot, and keep `foodRef` only as
   * a pointer for re-lookup and search.
   */
  macros: macrosSchema,
  foodRef: z.string().nullable(),

  loggedAt: isoInstantSchema,
  timezone: timeZoneSchema,
  localDate: localDateSchema,
  source: dataSourceSchema,

  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});
export type FoodEntry = z.infer<typeof foodEntrySchema>;

export const createFoodEntrySchema = z.object({
  name: z.string().min(1).max(120),
  mealType: mealTypeSchema,
  servings: z.number().positive().max(100).default(1),
  /** Macros for ONE serving; the server multiplies. Keeps rounding in one place. */
  macrosPerServing: macrosSchema,
  foodRef: z.string().nullish(),
  loggedAt: isoInstantSchema.optional(),
});
export type CreateFoodEntryInput = z.infer<typeof createFoodEntrySchema>;

export const updateFoodEntrySchema = createFoodEntrySchema.partial();
export type UpdateFoodEntryInput = z.infer<typeof updateFoodEntrySchema>;

/**
 * A per-day rollup, materialized on every FoodEntry write.
 *
 * This is a pure cache — it must always be rebuildable from FoodEntry alone, and a
 * `nutrition:rebuild` job exists to prove it. It exists because the Today screen
 * reads one document per day instead of summing an unbounded list on every render.
 */
export const dailyNutritionSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  localDate: localDateSchema,
  totals: macrosSchema,
  byMeal: z.record(mealTypeSchema, macrosSchema),
  entryCount: z.number().int().nonnegative(),
  updatedAt: isoInstantSchema,
});
export type DailyNutrition = z.infer<typeof dailyNutritionSchema>;

export function scaleMacros(per: Macros, servings: number): Macros {
  const round = (n: number) => Math.round(n * 10) / 10; // one decimal; grams below that are noise
  return {
    calories: Math.round(per.calories * servings),
    proteinG: round(per.proteinG * servings),
    carbsG: round(per.carbsG * servings),
    fatG: round(per.fatG * servings),
  };
}

export function sumMacros(items: readonly Macros[]): Macros {
  const round = (n: number) => Math.round(n * 10) / 10;
  return items.reduce<Macros>(
    (acc, m) => ({
      calories: acc.calories + m.calories,
      proteinG: round(acc.proteinG + m.proteinG),
      carbsG: round(acc.carbsG + m.carbsG),
      fatG: round(acc.fatG + m.fatG),
    }),
    { ...ZERO_MACROS },
  );
}

// ─── Photo food logging ─────────────────────────────────────────────────────
//
// A user photographs a plate; a vision model identifies what's on it and estimates
// the macros. This is the one place in the nutrition domain where a model is allowed
// to produce a number — and it is allowed ONLY because the user deliberately pointed
// a camera at their food and will confirm the result before anything is written.
//
// Contrast the meal DETECTOR (see detectors.ts on the server), which infers "you
// probably ate lunch" from a food expense and deliberately refuses to guess calories.
// The difference is evidence: a photo of the food is evidence about the food. A
// restaurant charge is not.
//
// The honest limit of this feature is PORTION SIZE. Identifying biryani from a photo
// is reliable; knowing whether that plate holds 200g or 400g of it is not, and portion
// is what actually drives the calorie count. So portion is a first-class, adjustable,
// user-confirmed field rather than a number hidden inside an estimate.

export const portionUnitSchema = z.enum(['g', 'ml', 'piece', 'cup', 'bowl', 'plate', 'slice']);
export type PortionUnit = z.infer<typeof portionUnitSchema>;

/** One food the model believes it can see on the plate. */
export const draftFoodItemSchema = z.object({
  name: z.string().min(1).max(120),

  /** The model's portion estimate — the number the user is most likely to correct. */
  portionQty: z.number().positive().max(10_000),
  portionUnit: portionUnitSchema,

  /** Macros for the estimated portion above, NOT per 100g. */
  macros: macrosSchema,

  /**
   * How sure the model is that it identified this food correctly.
   * Deliberately separate from portionConfidence: "that is definitely a samosa" and
   * "that is definitely 60 grams of samosa" are different claims with different
   * reliability, and collapsing them into one number hides the weaker one.
   */
  identifyConfidence: confidenceSchema,
  portionConfidence: confidenceSchema,

  /** What the model saw that led it here — shown to the user so they can check it. */
  reasoning: z.string().max(300).nullable(),
});
export type DraftFoodItem = z.infer<typeof draftFoodItemSchema>;

export const foodIngestionStatusSchema = z.enum([
  'needs_review',
  'confirmed',
  'rejected',
  'failed',
]);
export type FoodIngestionStatus = z.infer<typeof foodIngestionStatusSchema>;

export const foodIngestionSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  status: foodIngestionStatusSchema,
  mealType: mealTypeSchema,
  items: z.array(draftFoodItemSchema),
  /** The model's own caveat, surfaced verbatim rather than hidden. */
  caveat: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: isoInstantSchema,
  expiresAt: isoInstantSchema,
});
export type FoodIngestion = z.infer<typeof foodIngestionSchema>;

/** Confirming a photo: the user accepts, edits, or drops each identified item. */
export const confirmFoodPhotoSchema = z.object({
  mealType: mealTypeSchema.optional(),
  loggedAt: isoInstantSchema.optional(),
  items: z
    .array(
      z.object({
        itemIndex: z.number().int().nonnegative(),
        /** Corrections. Anything omitted keeps the model's estimate. */
        name: z.string().min(1).max(120).optional(),
        /** Scales the macros linearly — the primary correction affordance. */
        portionQty: z.number().positive().max(10_000).optional(),
        macros: macrosSchema.optional(),
      }),
    )
    .min(1),
});
export type ConfirmFoodPhotoInput = z.infer<typeof confirmFoodPhotoSchema>;

/**
 * Rescale macros when the user corrects the portion.
 *
 * Linear in portion, which is right for a plate of rice and wrong for nothing that
 * matters at this precision. Done in code, on the client AND the server, so the number
 * the user sees while dragging the stepper is the number that gets stored.
 */
export function rescaleForPortion(
  item: Pick<DraftFoodItem, 'macros' | 'portionQty'>,
  newPortionQty: number,
): Macros {
  if (item.portionQty <= 0) return { ...ZERO_MACROS };
  return scaleMacros(item.macros, newPortionQty / item.portionQty);
}

/**
 * The single confidence to show a user, which is the WEAKER of the two.
 *
 * A perfect identification with a wild portion guess still yields a wild calorie
 * count, and reporting the higher number would flatter the estimate. The user is being
 * asked to trust a calorie figure, so they should be told how much the *calorie figure*
 * can be trusted — which is governed by the weakest link.
 */
export function overallFoodConfidence(item: DraftFoodItem): number {
  return Math.min(item.identifyConfidence, item.portionConfidence);
}
