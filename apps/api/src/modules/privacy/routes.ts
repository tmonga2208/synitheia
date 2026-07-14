import { Types } from 'mongoose';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { connectableSourceSchema } from '@synitheia/shared';
import {
  AIInsightModel,
  DailyNutritionModel,
  DailySummaryModel,
  DataSourceConnectionModel,
  ExpenseIngestionModel,
  ExpenseModel,
  FoodEntryModel,
  FoodIngestionModel,
  HabitLogModel,
  HabitModel,
  InferredContextModel,
  PersonalEventModel,
  ReceiptModel,
  RefreshTokenModel,
  ReminderModel,
  UserModel,
  UserPreferenceModel,
  WaterEntryModel,
} from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import { purgeAllReceipts } from '../expenses/receipts.js';
import { loadEnv } from '../../config/env.js';

/**
 * Privacy is an architectural surface, not a settings page.
 *
 * These routes back the Connected Context screen, which exists so a user can answer,
 * at any moment: what do you know about me, where did it come from, when did you last
 * take it, can the AI see it, and how do I make you stop. Every collector consults
 * DataSourceConnection at runtime — a source disabled here cannot be read even if the
 * OS permission is still granted, because the permission and the consent are two
 * different things and only one of them is ours to honour.
 */

/**
 * What each source is for, in the user's language.
 *
 * Kept server-side rather than hardcoded in the app so that the stated purpose and the
 * actual collection can never drift apart across an app-store release cycle. If we
 * start using a source for something new, this string changes in the same deploy.
 */
const SOURCE_COPY: Record<
  string,
  { title: string; why: string; platforms: string; reliability: string }
> = {
  health: {
    title: 'Health & Activity',
    why: 'Steps, workouts, and sleep appear on your timeline and let Synítheia notice things like lower activity on days you eat more.',
    platforms: 'Apple Health on iOS · Health Connect on Android',
    reliability:
      'Reliable for steps. Sleep and workouts depend on what your phone or watch actually records.',
  },
  calendar: {
    title: 'Calendar',
    why: 'Meetings give your day structure, and make observations like "you skip workouts on days with late meetings" possible.',
    platforms: 'iOS and Android',
    reliability: 'Reliable. Read-only — we never write to your calendar.',
  },
  location: {
    title: 'Location',
    why: 'Recognising the places you visit regularly lets us suggest an expense or a meal instead of asking you to type it.',
    platforms: 'iOS and Android',
    reliability:
      'Best-effort. The operating system limits background location to save battery, so some visits will be missed.',
  },
  weather: {
    title: 'Weather',
    why: 'Weather is context for your day — it helps explain a low-step Sunday.',
    platforms: 'iOS and Android',
    reliability: 'Reliable. Uses only your approximate area, never a precise position.',
  },
  notifications: {
    title: 'Notifications',
    why: 'Not available. Reading your notifications is impossible on iOS, and app-store policy does not permit it for expense tracking on Android. Share a payment screenshot instead — it takes two taps and we never have to watch your notifications.',
    platforms: 'Not available on either platform',
    reliability: 'Not available.',
  },
};

export async function registerPrivacyRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const env = loadEnv();

  api.get('/data-sources', { onRequest: [app.requireAuth] }, async (req) => {
    const uid = new Types.ObjectId(req.user.id);
    const connections = await DataSourceConnectionModel.find({ userId: uid }).lean();
    const bySource = new Map(connections.map((c) => [c.source, c]));

    // Every known source is listed, connected or not. A source the user has never
    // enabled must still be visible and explained — a privacy screen that only shows
    // what you already agreed to is a receipt, not a control panel.
    const items = Object.entries(SOURCE_COPY).map(([source, copy]) => {
      const conn = bySource.get(source);
      const unavailable = source === 'notifications';

      return {
        source,
        ...copy,
        status: unavailable ? 'unavailable' : (conn?.status ?? 'disabled'),
        lastSyncedAt: conn?.lastSyncedAt ?? null,
        lastSyncError: conn?.lastSyncError ?? null,
        eventCount: conn?.eventCount ?? 0,
        aiAllowed: conn?.aiAllowed ?? false,
        connectedAt: conn?.connectedAt ?? null,
      };
    });

    return { items };
  });

  api.put(
    '/data-sources/:source',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ source: connectableSourceSchema }),
        body: z.object({
          status: z.enum(['connected', 'denied', 'disabled']),
          grantedScopes: z.array(z.string()).default([]),
          /**
           * Separate from `status` on purpose. Consenting to *collect* a source and
           * consenting to let a model *reason about* it are different decisions, and
           * bundling them would be exactly the dark pattern the brief rules out.
           */
          aiAllowed: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const { source } = req.params;

      if (source === 'notifications') {
        throw AppError.badRequest(
          'Notification access is not available: iOS exposes no API for it, and Play Store policy does not permit it for this use case.',
        );
      }

      const connection = await DataSourceConnectionModel.findOneAndUpdate(
        { userId: new Types.ObjectId(req.user.id), source },
        {
          $set: {
            status: req.body.status,
            grantedScopes: req.body.grantedScopes,
            ...(req.body.aiAllowed !== undefined ? { aiAllowed: req.body.aiAllowed } : {}),
            ...(req.body.status === 'connected' ? { connectedAt: new Date() } : {}),
          },
        },
        { upsert: true, new: true },
      ).lean();

      // Disabling a source withdraws it from the AI too. Leaving aiAllowed set on a
      // disconnected source would mean a user who turned Location off still had their
      // historical location data reasoned about — which is not what "off" means.
      if (req.body.status !== 'connected') {
        await DataSourceConnectionModel.updateOne(
          { userId: new Types.ObjectId(req.user.id), source },
          { $set: { aiAllowed: false } },
        );
        await UserPreferenceModel.updateOne(
          { userId: new Types.ObjectId(req.user.id) },
          { $pull: { aiAllowedSources: source } },
        );
      } else if (req.body.aiAllowed) {
        await UserPreferenceModel.updateOne(
          { userId: new Types.ObjectId(req.user.id) },
          { $addToSet: { aiAllowedSources: source } },
        );
      }

      return { connection };
    },
  );

  /**
   * Receipt image storage, on or off.
   *
   * Turning it OFF purges everything already stored. A privacy toggle that only stops
   * future collection while quietly keeping what it already took is not a privacy toggle.
   */
  api.put(
    '/privacy/receipts',
    {
      onRequest: [app.requireAuth],
      schema: { body: z.object({ storeReceipts: z.boolean() }) },
    },
    async (req) => {
      const preferences = await UserPreferenceModel.findOneAndUpdate(
        { userId: new Types.ObjectId(req.user.id) },
        { $set: { storeReceipts: req.body.storeReceipts } },
        { new: true, upsert: true },
      ).lean();

      const purged = req.body.storeReceipts
        ? 0
        : await purgeAllReceipts(env, req.user.id);

      return { preferences, purgedReceipts: purged };
    },
  );

  api.put(
    '/privacy/ai',
    {
      onRequest: [app.requireAuth],
      schema: {
        body: z.object({
          aiEnabled: z.boolean(),
          aiAllowedSources: z.array(connectableSourceSchema).optional(),
          aiIncludeNotes: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const preferences = await UserPreferenceModel.findOneAndUpdate(
        { userId: new Types.ObjectId(req.user.id) },
        { $set: req.body },
        { new: true, upsert: true },
      ).lean();

      return { preferences };
    },
  );

  /**
   * Delete the data a single source ever contributed, without touching anything the
   * user entered by hand. "Disconnect and forget" has to actually forget, or the
   * toggle is theatre.
   */
  api.delete(
    '/data-sources/:source/data',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ source: connectableSourceSchema }) },
    },
    async (req) => {
      const uid = new Types.ObjectId(req.user.id);

      const { deletedCount } = await PersonalEventModel.deleteMany({
        userId: uid,
        source: req.params.source,
      });

      await DataSourceConnectionModel.updateOne(
        { userId: uid, source: req.params.source },
        { $set: { status: 'disabled', aiAllowed: false, eventCount: 0, lastSyncedAt: null } },
      );

      // Summaries are derived from events, so they are now stale. Drop them; they
      // rebuild on next read from what remains.
      await DailySummaryModel.deleteMany({ userId: uid });

      return { deletedEvents: deletedCount };
    },
  );

  api.get('/privacy/export', { onRequest: [app.requireAuth] }, async (req) => {
    const uid = new Types.ObjectId(req.user.id);

    const [
      user,
      preferences,
      expenses,
      habits,
      habitLogs,
      food,
      water,
      reminders,
      events,
      inferences,
      insights,
      connections,
    ] = await Promise.all([
      UserModel.findById(uid).lean(),
      UserPreferenceModel.findOne({ userId: uid }).lean(),
      ExpenseModel.find({ userId: uid }).lean(),
      HabitModel.find({ userId: uid }).lean(),
      HabitLogModel.find({ userId: uid }).lean(),
      FoodEntryModel.find({ userId: uid }).lean(),
      WaterEntryModel.find({ userId: uid }).lean(),
      ReminderModel.find({ userId: uid }).lean(),
      PersonalEventModel.find({ userId: uid }).lean(),
      InferredContextModel.find({ userId: uid }).lean(),
      AIInsightModel.find({ userId: uid }).lean(),
      DataSourceConnectionModel.find({ userId: uid }).lean(),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      user,
      preferences,
      expenses,
      habits,
      habitLogs,
      food,
      water,
      reminders,
      events,
      inferences,
      insights,
      connections,
    };
  });

  /**
   * Full account deletion. Hard, not soft.
   *
   * A "deleted" account that is really just a flag is a lie we would be telling
   * someone who asked us to forget their health, financial, and location history.
   */
  api.delete(
    '/privacy/account',
    {
      onRequest: [app.requireAuth],
      schema: {
        body: z.object({
          // Typing your own email is a deliberate speed bump on an irreversible action.
          confirmEmail: z.string().email(),
        }),
      },
    },
    async (req, reply) => {
      const uid = new Types.ObjectId(req.user.id);
      const user = await UserModel.findById(uid, { email: 1 }).lean();

      if (!user) throw AppError.notFound('User');
      if (user.email !== req.body.confirmEmail.toLowerCase().trim()) {
        throw AppError.badRequest('The email you entered does not match this account');
      }

      await Promise.all([
        ExpenseModel.deleteMany({ userId: uid }),
        ExpenseIngestionModel.deleteMany({ userId: uid }),
        ReceiptModel.deleteMany({ userId: uid }),
        HabitModel.deleteMany({ userId: uid }),
        HabitLogModel.deleteMany({ userId: uid }),
        FoodEntryModel.deleteMany({ userId: uid }),
        FoodIngestionModel.deleteMany({ userId: uid }),
        DailyNutritionModel.deleteMany({ userId: uid }),
        WaterEntryModel.deleteMany({ userId: uid }),
        ReminderModel.deleteMany({ userId: uid }),
        PersonalEventModel.deleteMany({ userId: uid }),
        InferredContextModel.deleteMany({ userId: uid }),
        DailySummaryModel.deleteMany({ userId: uid }),
        AIInsightModel.deleteMany({ userId: uid }),
        DataSourceConnectionModel.deleteMany({ userId: uid }),
        UserPreferenceModel.deleteMany({ userId: uid }),
        RefreshTokenModel.deleteMany({ userId: uid }),
      ]);

      await UserModel.deleteOne({ _id: uid });

      return reply.status(204).send();
    },
  );
}
