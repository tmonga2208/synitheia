import { z } from 'zod';
import { Types } from 'mongoose';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  confirmFoodPhotoSchema,
  createFoodEntrySchema,
  localDateSchema,
  mealTypeSchema,
  objectIdSchema,
  rescaleForPortion,
  scaleMacros,
  todayLocalDate,
  toLocalDate,
  updateFoodEntrySchema,
  type DraftFoodItem,
  type LocalDate,
} from '@synitheia/shared';
import { AppError } from '../../core/errors.js';
import { FoodEntryModel } from '../../db/models.js';
import { retractByRef } from '../../context/engine.js';
import { loadEnv } from '../../config/env.js';
import * as vision from './vision.js';
import {
  createFoodEntry,
  emitFoodLogged,
  readDaily,
  rebuildDaily,
  type FoodEntryWithId,
} from './service.js';

export async function registerNutritionRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const env = loadEnv();

  api.post(
    '/food',
    {
      onRequest: [app.requireAuth],
      schema: { body: createFoodEntrySchema },
    },
    async (req, reply) => {
      const { entry, daily } = await createFoodEntry(req.user, req.body);
      return reply.status(201).send({ entry, daily });
    },
  );

  api.get(
    '/food',
    {
      onRequest: [app.requireAuth],
      schema: { querystring: z.object({ localDate: localDateSchema.optional() }) },
    },
    async (req) => {
      const localDate =
        (req.query.localDate as LocalDate | undefined) ??
        todayLocalDate(req.user.timezone);

      const [items, daily] = await Promise.all([
        FoodEntryModel.find({ userId: new Types.ObjectId(req.user.id), localDate })
          .sort({ loggedAt: 1 })
          .lean<FoodEntryWithId[]>(),
        readDaily(req.user.id, localDate),
      ]);

      return { items, daily };
    },
  );

  api.patch(
    '/food/:id',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: updateFoodEntrySchema,
      },
    },
    async (req) => {
      const entry = await FoodEntryModel.findOne({
        _id: new Types.ObjectId(req.params.id),
        userId: new Types.ObjectId(req.user.id),
      });

      if (!entry) throw AppError.notFound('Food entry');

      const previousLocalDate = entry.localDate as LocalDate;

      if (req.body.name !== undefined) entry.name = req.body.name;
      if (req.body.mealType !== undefined) entry.mealType = req.body.mealType;
      if (req.body.foodRef !== undefined) entry.foodRef = req.body.foodRef ?? null;

      if (req.body.macrosPerServing !== undefined || req.body.servings !== undefined) {
        // Rescaling needs the per-serving numbers, and we deliberately never stored
        // them — only the snapshot. Dividing the snapshot back out would compound the
        // rounding on every edit, so the client (which just displayed them) resends them.
        if (req.body.macrosPerServing === undefined) {
          throw AppError.badRequest(
            'Changing servings requires macrosPerServing to be sent with it',
          );
        }
        const servings = req.body.servings ?? entry.servings;
        entry.servings = servings;
        entry.macros = scaleMacros(req.body.macrosPerServing, servings);
      }

      if (req.body.loggedAt) {
        entry.loggedAt = req.body.loggedAt;
        // The timezone stays as it was — re-timing a meal does not relocate the user.
        entry.localDate = toLocalDate(req.body.loggedAt, entry.timezone);
      }

      await entry.save();
      await emitFoodLogged(req.user, entry);

      const localDate = entry.localDate as LocalDate;
      // Moving an entry across midnight invalidates the day it left, too.
      if (localDate !== previousLocalDate) {
        await rebuildDaily(req.user.id, previousLocalDate);
      }
      const daily = await rebuildDaily(req.user.id, localDate);

      return { entry, daily };
    },
  );

  api.delete(
    '/food/:id',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req, reply) => {
      const entry = await FoodEntryModel.findOneAndDelete({
        _id: new Types.ObjectId(req.params.id),
        userId: new Types.ObjectId(req.user.id),
      }).lean<FoodEntryWithId>();

      if (!entry) throw AppError.notFound('Food entry');

      await retractByRef(req.user.id, req.params.id);
      await rebuildDaily(req.user.id, entry.localDate as LocalDate);

      return reply.status(204).send();
    },
  );

  api.get(
    '/nutrition/daily',
    {
      onRequest: [app.requireAuth],
      schema: { querystring: z.object({ localDate: localDateSchema.optional() }) },
    },
    async (req) =>
      readDaily(
        req.user.id,
        (req.query.localDate as LocalDate | undefined) ??
          todayLocalDate(req.user.timezone),
      ),
  );

  // ─── Photo food logging ───────────────────────────────────────────────────
  //
  // Photo -> DRAFTS -> the user corrects the portion -> confirm -> FoodEntry.
  // Nothing here writes to the nutrition log. That only happens on confirm, below.

  api.post(
    '/food/photo',
    {
      onRequest: [app.requireAuth],
      // Vision calls are the most expensive thing this API does. A tighter limit than
      // the global one keeps a stuck retry loop on a phone from running up a bill.
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const file = await req.file();
      if (!file) throw AppError.badRequest('No photo was uploaded');

      const mealType = mealTypeSchema
        .catch('snack')
        .parse((file.fields.mealType as { value?: string } | undefined)?.value);

      const buffer = await file.toBuffer();

      const ingestion = await vision.analyzeFoodPhoto(
        env,
        req.user,
        { base64: buffer.toString('base64'), mediaType: file.mimetype },
        mealType,
      );

      return reply.status(201).send({ ingestion });
    },
  );

  api.get(
    '/food/photo/:id',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req) => ({
      ingestion: await vision.getFoodIngestion(req.user.id, req.params.id),
    }),
  );

  api.post(
    '/food/photo/:id/reject',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req, reply) => {
      await vision.markFoodIngestion(req.user.id, req.params.id, 'rejected');
      return reply.status(204).send();
    },
  );

  /**
   * The only path from a photo estimate to a real FoodEntry.
   *
   * The user names which items they accept and may correct the portion on each. A
   * corrected portion rescales the macros through the SAME shared helper the client
   * used to preview them, so the number they saw while adjusting the stepper is exactly
   * the number that gets stored.
   *
   * Entries are written with source 'inferred', so the app can keep telling the truth
   * about which numbers were measured and which were estimated from a photograph —
   * permanently, not just at the moment of logging.
   */
  api.post(
    '/food/photo/:id/confirm',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: confirmFoodPhotoSchema,
      },
    },
    async (req, reply) => {
      const ingestion = await vision.getFoodIngestion(req.user.id, req.params.id);

      if (ingestion.status !== 'needs_review') {
        throw AppError.conflict('This photo has already been reviewed');
      }

      const items = ingestion.items as unknown as DraftFoodItem[];
      // The meal is whatever the user says at confirm time; the value captured when the
      // photo was taken is only a default (a late-night plate is often mislabelled).
      const mealType = req.body.mealType ?? mealTypeSchema.parse(ingestion.mealType);

      const created = [];

      for (const chosen of req.body.items) {
        const draft = items[chosen.itemIndex];
        if (!draft) {
          throw AppError.badRequest(`No item at index ${chosen.itemIndex}`);
        }

        const macros =
          chosen.macros ??
          (chosen.portionQty !== undefined
            ? rescaleForPortion(draft, chosen.portionQty)
            : draft.macros);

        const { entry } = await createFoodEntry(
          req.user,
          {
            name: chosen.name ?? draft.name,
            mealType,
            servings: 1,
            // Already scaled to the confirmed portion, so one "serving" IS that portion.
            macrosPerServing: macros,
            loggedAt: req.body.loggedAt,
          },
          'inferred',
        );

        created.push(entry);
      }

      await vision.markFoodIngestion(req.user.id, req.params.id, 'confirmed');

      const localDate = toLocalDate(req.body.loggedAt ?? new Date(), req.user.timezone);
      const daily = await rebuildDaily(req.user.id, localDate);

      return reply.status(201).send({ entries: created, daily });
    },
  );
}
