import { z } from 'zod';
import { Types } from 'mongoose';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createWaterEntrySchema,
  localDateSchema,
  objectIdSchema,
  toLocalDate,
  todayLocalDate,
  type CreateWaterEntryInput,
  type LocalDate,
} from '@synitheia/shared';
import { AppError } from '../../core/errors.js';
import { UserPreferenceModel, WaterEntryModel, type WaterEntryDoc } from '../../db/models.js';
import { dedupeKey, emit, retractByRef } from '../../context/engine.js';
import type { AuthedUser } from '../../core/auth-guard.js';

type WaterEntryWithId = WaterEntryDoc & { _id: Types.ObjectId };

/** Water is small enough that it lives here rather than in a service.ts of its own. */

const DEFAULT_TARGET_ML = 2500;

/** Preferences are created lazily at onboarding, so a user may not have a doc yet. */
async function targetMlFor(userId: string): Promise<number> {
  const prefs = await UserPreferenceModel.findOne(
    { userId: new Types.ObjectId(userId) },
    { waterTargetMl: 1 },
  ).lean();

  return prefs?.waterTargetMl ?? DEFAULT_TARGET_ML;
}

async function listEntries(
  userId: string,
  localDate: LocalDate,
): Promise<WaterEntryWithId[]> {
  return WaterEntryModel.find({
    userId: new Types.ObjectId(userId),
    localDate,
  })
    .sort({ loggedAt: -1 })
    .lean<WaterEntryWithId[]>();
}

function sumMl(entries: readonly Pick<WaterEntryDoc, 'amountMl'>[]): number {
  return entries.reduce((total, entry) => total + entry.amountMl, 0);
}

/** The day's running total, read back from the store rather than incremented. */
async function totalMlOn(userId: string, localDate: LocalDate): Promise<number> {
  const entries = await WaterEntryModel.find(
    { userId: new Types.ObjectId(userId), localDate },
    { amountMl: 1 },
  ).lean();

  return sumMl(entries);
}

async function createEntry(
  user: AuthedUser,
  input: CreateWaterEntryInput,
): Promise<{ entry: WaterEntryWithId; totalMl: number; targetMl: number }> {
  const loggedAt = input.loggedAt ?? new Date();

  // The user's day, never the server's. A user in Tokyo logging at 08:00 local is on
  // today's ring, not on yesterday's because the box in us-east-1 is still on the 11th.
  const localDate = toLocalDate(loggedAt, user.timezone);

  const doc = {
    userId: new Types.ObjectId(user.id),
    amountMl: input.amountMl,
    loggedAt,
    timezone: user.timezone,
    localDate,
    source: 'manual',
    clientKey: input.clientKey ?? null,
  };

  /**
   * With a clientKey, the write is an upsert against the unique (userId, clientKey)
   * index: a double-tapped glass icon or a mobile retry lands on the same row instead
   * of logging 500ml twice. `$setOnInsert` — not `$set` — is what makes the retry a
   * true no-op rather than an overwrite, and returns the entry the first call created.
   */
  const entry = input.clientKey
    ? ((await WaterEntryModel.findOneAndUpdate(
        { userId: new Types.ObjectId(user.id), clientKey: input.clientKey },
        { $setOnInsert: doc },
        { upsert: true, new: true },
      )) as WaterEntryWithId)
    : ((await WaterEntryModel.create(doc)) as WaterEntryWithId);

  // Computed after the insert, because the event's metadata reports the day total as
  // of this glass — and on a deduped retry that total must not move.
  const totalMl = await totalMlOn(user.id, entry.localDate as LocalDate);
  const targetMl = await targetMlFor(user.id);

  await emit({
    userId: user.id,
    source: 'manual',
    timestamp: entry.loggedAt,
    timezone: entry.timezone,
    refId: entry._id,
    dedupeKey: dedupeKey('manual', 'water', entry._id.toString()),
    metadata: {
      type: 'water.logged',
      amountMl: entry.amountMl,
      totalMlToday: totalMl,
      targetMl,
    },
  });

  return { entry, totalMl, targetMl };
}

export async function registerWaterRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    '/water',
    {
      onRequest: [app.requireAuth],
      schema: { body: createWaterEntrySchema },
    },
    async (req, reply) => {
      const result = await createEntry(req.user, req.body);
      return reply.status(201).send(result);
    },
  );

  api.get(
    '/water',
    {
      onRequest: [app.requireAuth],
      schema: { querystring: z.object({ localDate: localDateSchema.optional() }) },
    },
    async (req) => {
      const localDate =
        (req.query.localDate as LocalDate | undefined) ?? todayLocalDate(req.user.timezone);

      const [items, targetMl] = await Promise.all([
        listEntries(req.user.id, localDate),
        targetMlFor(req.user.id),
      ]);

      return { items, totalMl: sumMl(items), targetMl };
    },
  );

  api.delete(
    '/water/:id',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req, reply) => {
      const result = await WaterEntryModel.deleteOne({
        _id: new Types.ObjectId(req.params.id),
        userId: new Types.ObjectId(req.user.id),
      });

      if (result.deletedCount === 0) throw AppError.notFound('Water entry');

      // The timeline is a projection — a mis-tapped glass must vanish from Today too.
      await retractByRef(req.user.id, req.params.id);

      return reply.status(204).send();
    },
  );
}
