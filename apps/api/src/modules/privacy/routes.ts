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
  ExpenseCategoryModel,
  ExpenseIngestionModel,
  ExpenseModel,
  FoodEntryModel,
  FoodIngestionModel,
  HabitLogModel,
  HabitModel,
  HealthDayModel,
  WeightEntryModel,
  IdempotencyRecordModel,
  InferredContextModel,
  PasswordResetModel,
  PersonalEventModel,
  ReceiptModel,
  RefreshTokenModel,
  ReminderModel,
  SubscriptionModel,
  UserModel,
  UserPreferenceModel,
  WaterEntryModel,
  XpAwardModel,
} from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import { aiAllowedSources } from '../../ai/context-builder.js';
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
    reliability: 'Sleep and workouts show up if your phone or watch records them.',
  },
  calendar: {
    title: 'Calendar',
    why: 'Meetings give your day structure, and make observations like "you skip workouts on days with late meetings" possible.',
    platforms: 'iOS and Android',
    reliability: 'Read only. Synítheia never changes your calendar.',
  },
  location: {
    title: 'Location',
    why: 'Recognising the places you visit regularly lets us suggest an expense or a meal instead of asking you to type it.',
    platforms: 'iOS and Android',
    reliability: 'Your phone may skip some visits to save battery.',
  },
  weather: {
    title: 'Weather',
    why: 'Weather is context for your day — it helps explain a low-step Sunday.',
    platforms: 'iOS and Android',
    reliability: 'Uses only your rough area, never your exact location.',
  },
  // Android can grant notification access; this used to say store policy forbids it, which
  // was never checked. What is true is that the app chooses not to ask (see README).
  notifications: {
    title: 'Notifications',
    why: 'Not read: it would mean reading every notification you get. Pick a payment screenshot or paste the message instead.',
    platforms: 'Not possible on iOS · not used on Android',
    reliability: '',
  },
};

interface UserCollection {
  /** The name this collection has in an export. */
  key: string;
  /** False for credentials: an export is a file a person may hand to someone else. */
  exported: boolean;
  read: (userId: Types.ObjectId) => Promise<unknown[]>;
  remove: (userId: Types.ObjectId) => Promise<void>;
}

/**
 * The two things this file asks of a model. Spelled out rather than written as mongoose's
 * `Model<T>`, whose type parameters make twenty differently shaped models unassignable to
 * one signature. What every one of them does have is a `userId` to be found and deleted by.
 */
interface OwnedByUser {
  find: (filter: { userId: Types.ObjectId }) => { lean: () => { exec: () => Promise<unknown[]> } };
  deleteMany: (filter: { userId: Types.ObjectId }) => PromiseLike<unknown>;
}

function userCollection(key: string, model: OwnedByUser, exported = true): UserCollection {
  return {
    key,
    exported,
    read: (userId) => model.find({ userId }).lean().exec(),
    remove: async (userId) => {
      await model.deleteMany({ userId });
    },
  };
}

/**
 * Every collection that holds something of a user's.
 *
 * ONE list, used by both the export and account deletion, because they used to be two and
 * both fell behind as collections were added: deleting an account left daily health records,
 * subscriptions, categories and the XP ledger on the server, and the export left out those
 * and more. A collection added to models.ts and not added here fails routes.test.ts, which
 * asks the models themselves rather than trusting any list.
 */
const USER_DATA: UserCollection[] = [
  userCollection('preferences', UserPreferenceModel),
  userCollection('categories', ExpenseCategoryModel),
  userCollection('expenses', ExpenseModel),
  userCollection('expenseDrafts', ExpenseIngestionModel),
  userCollection('receipts', ReceiptModel),
  userCollection('subscriptions', SubscriptionModel),
  userCollection('habits', HabitModel),
  userCollection('habitLogs', HabitLogModel),
  userCollection('food', FoodEntryModel),
  userCollection('foodDrafts', FoodIngestionModel),
  userCollection('dailyNutrition', DailyNutritionModel),
  userCollection('water', WaterEntryModel),
  userCollection('reminders', ReminderModel),
  userCollection('healthDays', HealthDayModel),
  userCollection('weights', WeightEntryModel),
  userCollection('events', PersonalEventModel),
  userCollection('inferences', InferredContextModel),
  userCollection('dailySummaries', DailySummaryModel),
  userCollection('insights', AIInsightModel),
  userCollection('connections', DataSourceConnectionModel),
  userCollection('xpAwards', XpAwardModel),
  userCollection('refreshTokens', RefreshTokenModel, false),
  // A reset code is a credential too: deleted with the account, never exported.
  userCollection('passwordResets', PasswordResetModel, false),
  // Stored answers to resent changes (core/idempotency.ts): a cache, deleted, not exported.
  userCollection('idempotencyRecords', IdempotencyRecordModel, false),
];

/**
 * Rewrite the preferences' copy of the per-source AI choices from the connection rows.
 *
 * The rows are what the switches show and what the context builder obeys. The copy is kept
 * for the export, where it answers "what did I let the AI use?". It is rebuilt after every
 * change rather than patched, because patching is how it drifted: switching a source's AI
 * off left the source on the list.
 */
async function mirrorAiChoices(userId: string): Promise<void> {
  const allowed = await aiAllowedSources(userId);

  await UserPreferenceModel.updateOne(
    { userId: new Types.ObjectId(userId) },
    { $set: { aiAllowedSources: [...allowed] } },
  );
}

export async function registerPrivacyRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const env = loadEnv();

  api.get('/data-sources', { onRequest: [app.requireAuth] }, async (req) => {
    const uid = new Types.ObjectId(req.user.id);
    const [connections, counted] = await Promise.all([
      DataSourceConnectionModel.find({ userId: uid }).lean(),
      // Counted from the events themselves, so the number is what the timeline shows and
      // what "delete this source's data" removes. A counter kept beside them drifted.
      PersonalEventModel.aggregate<{ _id: string; count: number }>([
        { $match: { userId: uid } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]),
    ]);
    const bySource = new Map(connections.map((c) => [c.source, c]));
    const eventCounts = new Map(counted.map((row) => [row._id, row.count]));

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
        eventCount: eventCounts.get(source) ?? 0,
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
          'Synítheia does not read notifications. iOS offers no way to, and on Android the app chooses not to ask for that access.',
        );
      }

      // Disabling a source withdraws it from the AI too. Leaving aiAllowed set on a
      // disconnected source would mean a user who turned Location off still had their
      // historical location data reasoned about — which is not what "off" means.
      const aiAllowed = req.body.status === 'connected' ? req.body.aiAllowed : false;

      const connection = await DataSourceConnectionModel.findOneAndUpdate(
        { userId: new Types.ObjectId(req.user.id), source },
        {
          $set: {
            status: req.body.status,
            grantedScopes: req.body.grantedScopes,
            ...(aiAllowed !== undefined ? { aiAllowed } : {}),
            ...(req.body.status === 'connected' ? { connectedAt: new Date() } : {}),
          },
        },
        { upsert: true, new: true },
      ).lean();

      await mirrorAiChoices(req.user.id);

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
          // Not `aiAllowedSources`: which sources the AI may use is set one source at a
          // time, through the switches PUT /data-sources/:source records.
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
        { $set: { status: 'disabled', aiAllowed: false, lastSyncedAt: null } },
      );
      await mirrorAiChoices(req.user.id);

      // Health also keeps one record per day (steps, sleep, heart rate, workouts) outside the
      // timeline. Forgetting the events and keeping those would be forgetting the summary
      // of the thing and keeping the thing.
      if (req.params.source === 'health') {
        await HealthDayModel.deleteMany({ userId: uid });
        // Weights the user typed are theirs, not Health's; only Health's readings go.
        await WeightEntryModel.deleteMany({ userId: uid, source: 'health' });
      }

      // Summaries are derived from events, so they are now stale. Drop them; they
      // rebuild on next read from what remains.
      await DailySummaryModel.deleteMany({ userId: uid });

      return { deletedEvents: deletedCount };
    },
  );

  api.get('/privacy/export', { onRequest: [app.requireAuth] }, async (req) => {
    const uid = new Types.ObjectId(req.user.id);
    const exported = USER_DATA.filter((collection) => collection.exported);

    const [user, rows] = await Promise.all([
      UserModel.findById(uid).lean(),
      Promise.all(exported.map((collection) => collection.read(uid))),
    ]);

    const data = Object.fromEntries(exported.map((collection, i) => [collection.key, rows[i]]));

    return {
      exportedAt: new Date().toISOString(),
      user,
      ...data,
      // One document per user, and it has always been exported as an object, not a list.
      preferences: data.preferences?.[0] ?? null,
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

      // The stored images first, while the rows that say where they are still exist.
      // Deleting only the rows would leave the photos in storage with nothing pointing at
      // them: unreachable by us, and still there.
      await purgeAllReceipts(env, req.user.id);

      await Promise.all(USER_DATA.map((collection) => collection.remove(uid)));

      await UserModel.deleteOne({ _id: uid });

      return reply.status(204).send();
    },
  );
}
