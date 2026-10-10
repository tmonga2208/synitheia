import { Types } from 'mongoose';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { objectIdSchema, resolveInferenceSchema, type LocalDate } from '@synitheia/shared';
import { ExpenseCategoryModel, InferredContextModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import * as expenses from '../expenses/service.js';
import { createFoodEntry } from '../nutrition/service.js';
import { confirmHabitSuggestion } from './service.js';

/**
 * Resolving a suggestion — the "Confirm" half of Detect → Infer → Suggest → Confirm.
 *
 * This is the ONLY place an inference becomes real data. Nothing in the detector
 * pipeline writes a domain record; it only ever asks a question. A confirmation here
 * writes the Expense (or FoodEntry, etc.) through the normal domain service, so the
 * result is indistinguishable from something the user typed — same validation, same
 * event emission, same audit trail. A rejection records that we were wrong, which is
 * the signal the detectors are tuned against.
 */
export async function registerInferenceRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get('/inferences', { onRequest: [app.requireAuth] }, async (req) => ({
    items: await InferredContextModel.find({
      userId: new Types.ObjectId(req.user.id),
      status: 'pending',
      expiresAt: { $gt: new Date() },
    })
      .sort({ confidence: -1 })
      .lean(),
  }));

  api.post(
    '/inferences/:id/resolve',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: resolveInferenceSchema.extend({
          /** Required when confirming an expense — the user picks the category. */
          categoryId: objectIdSchema.optional(),
        }),
      },
    },
    async (req) => {
      const inference = await InferredContextModel.findOne({
        _id: new Types.ObjectId(req.params.id),
        userId: new Types.ObjectId(req.user.id),
      });

      if (!inference) throw AppError.notFound('Suggestion');
      if (inference.status !== 'pending') {
        throw AppError.conflict('This suggestion has already been resolved');
      }

      if (req.body.action === 'reject') {
        inference.status = 'rejected';
        inference.resolvedAt = new Date();
        await inference.save();

        // A rejection is a training signal, not a dead end. The detector that produced
        // it is recorded on the document, so a rule that is consistently wrong for this
        // user can be identified and its threshold raised.
        req.log.info(
          { detector: inference.detector, confidence: inference.confidence },
          'inference rejected by user',
        );

        return { status: 'rejected' as const, created: null };
      }

      const proposed = inference.proposed as { kind: string; [key: string]: unknown };
      let created: unknown = null;

      if (proposed.kind === 'expense') {
        const categoryId =
          req.body.categoryId ??
          (
            await ExpenseCategoryModel.findOne({
              userId: new Types.ObjectId(req.user.id),
              name: (proposed.suggestedCategoryName as string) ?? 'Other',
            }).lean()
          )?._id?.toString();

        if (!categoryId) {
          throw AppError.badRequest('Choose a category to confirm this expense');
        }

        // Corrections the user made before accepting override what we guessed. This is
        // the point of the whole flow: we propose, they correct, we learn.
        const corrected = req.body.corrections ?? {};

        created = await expenses.createExpense(req.user, {
          amountMinor: Number(corrected.amountMinor ?? proposed.amountMinor),
          categoryId,
          merchant: (corrected.merchant as string) ?? (proposed.merchant as string) ?? null,
          note: null,
        });
      }

      if (proposed.kind === 'food') {
        /**
         * The detector deliberately does NOT guess a calorie count (see detectors.ts),
         * so a confirmed meal starts at zero macros and the user fills them in. An
         * invented number here would be indistinguishable, in their nutrition history,
         * from one they actually measured — and they would never know which.
         *
         * `source: 'inferred'` is what lets the UI keep telling the truth about where
         * this entry came from, forever.
         */
        const corrected = req.body.corrections ?? {};

        created = await createFoodEntry(
          req.user,
          {
            name: String(corrected.name ?? proposed.name ?? 'Meal'),
            mealType: (corrected.mealType ?? proposed.mealType) as
              | 'breakfast'
              | 'lunch'
              | 'dinner'
              | 'snack',
            servings: 1,
            macrosPerServing: {
              calories: Number(corrected.calories ?? 0),
              proteinG: Number(corrected.proteinG ?? 0),
              carbsG: Number(corrected.carbsG ?? 0),
              fatG: Number(corrected.fatG ?? 0),
            },
          },
          'inferred',
        );
      }

      if (proposed.kind === 'habit') {
        created = await confirmHabitSuggestion(
          req.user,
          {
            localDate: inference.localDate as LocalDate,
            proposed: {
              habitId: String(proposed.habitId),
              count: Number(proposed.count),
            },
          },
          req.log,
        );
      }

      inference.status = 'confirmed';
      inference.resolvedAt = new Date();

      if (req.body.corrections && Object.keys(req.body.corrections).length > 0) {
        const [field, to] = Object.entries(req.body.corrections)[0]!;
        inference.correction = {
          field,
          from: String(proposed[field] ?? ''),
          to: String(to),
        };
      }

      await inference.save();

      return { status: 'confirmed' as const, created };
    },
  );
}
