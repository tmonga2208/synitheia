import { Types } from 'mongoose';
import { z } from 'zod';
import {
  type DraftFoodItem,
  type MealType,
} from '@synitheia/shared';
import { AppError } from '../../core/errors.js';
import { callStructured } from '../../ai/client.js';
import { FoodIngestionModel } from '../../db/models.js';
import type { Env } from '../../config/env.js';
import type { AuthedUser } from '../../core/auth-guard.js';

/**
 * Photo food logging.
 *
 * A user photographs a plate; a vision model names what's on it and estimates macros.
 * This is the ONE place in the nutrition domain where a model may produce a number, and
 * it is permitted only because the user deliberately pointed a camera at their food and
 * will confirm the result before anything is written. The meal detector, by contrast,
 * infers "you probably ate lunch" from a restaurant charge and refuses to guess calories
 * at all — because a charge is evidence about a payment, not about a plate.
 *
 * The output is DRAFTS. Nothing reaches DailyNutrition without confirmation.
 */

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

const visionSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        portionQty: z.number().positive().max(10_000),
        portionUnit: z.enum(['g', 'ml', 'piece', 'cup', 'bowl', 'plate', 'slice']),
        calories: z.number().nonnegative().max(20_000),
        proteinG: z.number().nonnegative().max(1000),
        carbsG: z.number().nonnegative().max(1000),
        fatG: z.number().nonnegative().max(1000),
        identifyConfidence: z.number().min(0).max(1),
        portionConfidence: z.number().min(0).max(1),
        reasoning: z.string().max(300).nullable(),
      }),
    )
    .max(15),
  caveat: z.string().max(300).nullable(),
});

const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    items: {
      type: 'array',
      description: 'Each distinct food visible. An empty array if this is not food.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'What the food is, specifically. "Chicken biryani", not "rice dish".',
          },
          portionQty: {
            type: 'number',
            description:
              'How much of it is present, in portionUnit. Use visible references for scale — a standard dinner plate is ~26cm, a teaspoon ~5ml, a chapati ~15cm.',
          },
          portionUnit: {
            type: 'string',
            enum: ['g', 'ml', 'piece', 'cup', 'bowl', 'plate', 'slice'],
          },
          calories: { type: 'number', description: 'kcal for the portion above — NOT per 100g.' },
          proteinG: { type: 'number' },
          carbsG: { type: 'number' },
          fatG: { type: 'number' },
          identifyConfidence: {
            type: 'number',
            description: 'How sure you are you named the food correctly (0-1).',
          },
          portionConfidence: {
            type: 'number',
            description:
              'How sure you are of the AMOUNT (0-1). This is usually much lower than identifyConfidence and it is the number that actually governs calorie accuracy. Do not inflate it.',
          },
          reasoning: {
            type: 'string',
            description: 'What you saw that led you here, so the user can check your work.',
          },
        },
        required: [
          'name',
          'portionQty',
          'portionUnit',
          'calories',
          'proteinG',
          'carbsG',
          'fatG',
          'identifyConfidence',
          'portionConfidence',
        ],
      },
    },
    caveat: {
      type: ['string', 'null'],
      description:
        'One short sentence on what would most change these numbers — hidden oil, unclear portion, obscured items. Null if nothing notable.',
    },
  },
  required: ['items'],
};

const SYSTEM_PROMPT = `You identify food in a photograph a user has taken of their own meal, and estimate its nutrition.

WHAT YOU ARE ACTUALLY UNCERTAIN ABOUT

Naming the food is usually easy. Judging HOW MUCH of it there is, is not — and portion size is what drives the calorie count. A plate of biryani is 400 kcal or 900 kcal depending on whether it holds 250g or 550g, and a photograph flattens exactly the depth cue you need to tell them apart. So:

- Report identifyConfidence and portionConfidence SEPARATELY, and be honest that the second is usually much lower. Do not let a confident identification drag the portion score up with it.
- Use visible objects for scale: a dinner plate is ~26cm across, a teaspoon ~5ml, a chapati ~15cm, a standard mug ~250ml. If the frame gives you nothing to scale against, say so in the caveat and lower portionConfidence accordingly.
- Cooking oil, ghee, butter, and sugar are frequently invisible and frequently dominate the calorie count. Assume typical preparation, and say so in the caveat when it matters.

RULES

1. Only list food you can actually SEE. Never complete a meal from expectation — do not add rice because there is curry, or a side because the plate looks empty.
2. Estimate for the portion actually shown, not a standard serving.
3. If the photo contains no food, return an empty items array. That is a correct answer.
4. A low confidence score is far more useful than a confident wrong number. The user will be shown these scores and asked to correct the portion; you are giving them a starting point, not a verdict.
5. Never moralise about the food. You are a measuring instrument, not a coach.`;

export async function analyzeFoodPhoto(
  env: Env,
  user: AuthedUser,
  image: { base64: string; mediaType: string },
  mealType: MealType,
) {
  const supported = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!supported.includes(image.mediaType)) {
    throw AppError.ingestionFailed(
      `Unsupported image type "${image.mediaType}". Use JPEG, PNG, WebP, or GIF.`,
    );
  }

  const result = await callStructured({
    env,
    system: SYSTEM_PROMPT,
    content: [
      { type: 'image', mediaType: image.mediaType, base64: image.base64 },
      {
        type: 'text',
        text: `Identify every food in this photo and estimate its nutrition. This is the user's ${mealType}.`,
      },
    ],
    outputName: 'record_foods',
    outputDescription:
      'The foods visible in the photo. An empty list is correct if there is no food.',
    schema: TOOL_SCHEMA,
    outputSchema: visionSchema,
    maxTokens: 2048,
  });

  if (result.items.length === 0) {
    throw AppError.ingestionFailed(
      "No food was found in that photo. Try a clearer shot of the plate, or add the meal manually.",
    );
  }

  const items: DraftFoodItem[] = result.items.map((i) => ({
    name: i.name,
    portionQty: i.portionQty,
    portionUnit: i.portionUnit,
    macros: {
      calories: Math.round(i.calories),
      proteinG: Math.round(i.proteinG * 10) / 10,
      carbsG: Math.round(i.carbsG * 10) / 10,
      fatG: Math.round(i.fatG * 10) / 10,
    },
    identifyConfidence: i.identifyConfidence,
    portionConfidence: i.portionConfidence,
    reasoning: i.reasoning ?? null,
  }));

  /**
   * The photo itself is NOT stored.
   *
   * It is sent to the model, the estimate comes back, and the bytes are dropped. A
   * server-side library of photographs of what someone eats is a serious privacy
   * liability that buys the user nothing — they already have the photo, on their phone,
   * where they took it. Keeping the drafts is enough to review and correct.
   */
  return FoodIngestionModel.create({
    userId: new Types.ObjectId(user.id),
    status: 'needs_review',
    mealType,
    items,
    caveat: result.caveat ?? null,
    error: null,
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
  });
}

export async function getFoodIngestion(userId: string, id: string) {
  const doc = await FoodIngestionModel.findOne({
    _id: new Types.ObjectId(id),
    userId: new Types.ObjectId(userId),
  }).lean();

  if (!doc) throw AppError.notFound('Photo');
  return doc;
}

export async function markFoodIngestion(
  userId: string,
  id: string,
  status: 'confirmed' | 'rejected',
) {
  const result = await FoodIngestionModel.updateOne(
    { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
    { $set: { status } },
  );

  if (result.matchedCount === 0) throw AppError.notFound('Photo');
}
