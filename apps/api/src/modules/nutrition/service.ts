import { Types } from 'mongoose';
import {
  scaleMacros,
  sumMacros,
  toLocalDate,
  ZERO_MACROS,
  type CreateFoodEntryInput,
  type DataSource,
  type LocalDate,
  type Macros,
  type MealType,
} from '@synitheia/shared';
import {
  DailyNutritionModel,
  FoodEntryModel,
  type DailyNutritionDoc,
  type FoodEntryDoc,
} from '../../db/models.js';
import { dedupeKey, emit } from '../../context/engine.js';
import type { AuthedUser } from '../../core/auth-guard.js';

export type FoodEntryWithId = FoodEntryDoc & { _id: Types.ObjectId };
export type DailyNutritionWithId = DailyNutritionDoc & { _id: Types.ObjectId };

/**
 * Recompute a day's rollup from scratch, from FoodEntry alone.
 *
 * DailyNutrition is a pure cache, and this is the only function allowed to write it.
 * The tempting alternative — `$inc` the totals by the delta on each write — drifts: an
 * edit that changes servings, a delete, a retried request, or a crash between the two
 * writes all leave the counter a few hundred calories off, and nothing ever notices.
 * The user then reads a headline number that is silently wrong, which is the one
 * failure mode this feature cannot survive. Summing a dozen rows is cheap; being wrong
 * about someone's calorie total is not.
 */
export async function rebuildDaily(
  userId: string,
  localDate: LocalDate,
): Promise<DailyNutritionWithId> {
  const entries = await FoodEntryModel.find(
    { userId: new Types.ObjectId(userId), localDate },
    { macros: 1, mealType: 1 },
  ).lean();

  const byMeal: Partial<Record<MealType, Macros>> = {};
  for (const entry of entries) {
    const meal = entry.mealType as MealType;
    byMeal[meal] = sumMacros([byMeal[meal] ?? ZERO_MACROS, entry.macros]);
  }

  const daily = await DailyNutritionModel.findOneAndUpdate(
    { userId: new Types.ObjectId(userId), localDate },
    {
      $set: {
        totals: sumMacros(entries.map((e) => e.macros)),
        byMeal,
        entryCount: entries.length,
      },
    },
    { upsert: true, new: true },
  );

  return daily as DailyNutritionWithId;
}

/** Read the cache, rebuilding on a miss — a cache that was never built is not an error. */
export async function readDaily(
  userId: string,
  localDate: LocalDate,
): Promise<DailyNutritionWithId> {
  const daily = await DailyNutritionModel.findOne({
    userId: new Types.ObjectId(userId),
    localDate,
  }).lean<DailyNutritionWithId>();

  return daily ?? rebuildDaily(userId, localDate);
}

/**
 * Re-emitting with the same dedupeKey updates the existing timeline row in place
 * rather than appending a second one, so create and update share this.
 */
export async function emitFoodLogged(
  user: AuthedUser,
  entry: FoodEntryWithId,
  source: DataSource = 'manual',
): Promise<void> {
  await emit({
    userId: user.id,
    source,
    timestamp: entry.loggedAt,
    timezone: entry.timezone,
    refId: entry._id,
    dedupeKey: dedupeKey('manual', 'food', entry._id.toString()),
    metadata: {
      type: 'food.logged',
      foodName: entry.name,
      mealType: entry.mealType as MealType,
      calories: entry.macros.calories,
      proteinG: entry.macros.proteinG,
      carbsG: entry.macros.carbsG,
      fatG: entry.macros.fatG,
    },
  });
}

/**
 * The single path from "a user wants this food logged" to a persisted FoodEntry.
 *
 * Lives here rather than inline in the route because confirming an inferred meal
 * ("Looks like you had lunch — add it?") must produce a food entry that is
 * indistinguishable from a hand-typed one: same scaling, same rollup rebuild, same
 * timeline event. The only difference is `source`, which is exactly the distinction
 * the user is entitled to see.
 */
export async function createFoodEntry(
  user: AuthedUser,
  input: CreateFoodEntryInput,
  source: DataSource = 'manual',
): Promise<{ entry: FoodEntryWithId; daily: DailyNutritionWithId }> {
  const loggedAt = input.loggedAt ?? new Date();
  const localDate = toLocalDate(loggedAt, user.timezone);

  const entry = (await FoodEntryModel.create({
    userId: new Types.ObjectId(user.id),
    name: input.name,
    mealType: input.mealType,
    servings: input.servings,
    // The snapshot: totals for `servings`, not a live lookup. See nutrition.ts.
    macros: scaleMacros(input.macrosPerServing, input.servings),
    foodRef: input.foodRef ?? null,
    loggedAt,
    timezone: user.timezone,
    localDate,
    source,
  })) as FoodEntryWithId;

  await emitFoodLogged(user, entry, source);
  const daily = await rebuildDaily(user.id, localDate);

  return { entry, daily };
}
