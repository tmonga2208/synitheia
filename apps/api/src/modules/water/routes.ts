import { z } from 'zod';
import { Types } from 'mongoose';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  awardsForWaterEntry,
  clientIdSchema,
  createWaterEntrySchema,
  localDateSchema,
  objectIdSchema,
  toLocalDate,
  todayLocalDate,
  type ClientId,
  type CreateWaterEntryInput,
  type LocalDate,
} from '@synitheia/shared';
import { rethrowTakenId, withClientId } from '../../core/clientId.js';
import { AppError } from '../../core/errors.js';
import { UserPreferenceModel, WaterEntryModel, type WaterEntryDoc } from '../../db/models.js';
import { invalidateDailySummary } from '../../context/aggregator.js';
import { dedupeKey, emit, retractByRef } from '../../context/engine.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { grantAwards } from '../xp/service.js';

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

/** Exported so it is reachable from a test without standing up a Fastify instance. */
export async function createEntry(
  user: AuthedUser,
  input: CreateWaterEntryInput & ClientId,
  /**
   * Optional so every direct caller in this codebase's tests keeps compiling
   * unchanged; the real route passes `req.log`, the same facility `today/routes.ts`
   * already uses for "this must not take down the main write" failures.
   */
  logger?: Pick<FastifyBaseLogger, 'warn'>,
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
        { $setOnInsert: withClientId(input.id, doc) },
        { upsert: true, new: true },
      ).catch(rethrowTakenId)) as WaterEntryWithId)
    : ((await WaterEntryModel.create(withClientId(input.id, doc)).catch(
        rethrowTakenId,
      )) as WaterEntryWithId);

  // Computed after the insert, because the event's metadata reports the day total as
  // of this glass — and on a deduped retry that total must not move.
  const totalMl = await totalMlOn(user.id, entry.localDate as LocalDate);
  const targetMl = await targetMlFor(user.id);

  // Invalidate before the emit, not after: the water row has already landed, and an
  // exception out of emit must not be able to suppress the invalidation.
  await invalidateDailySummary(user.id, entry.localDate as LocalDate);

  /**
   * XP is a nicety layered on top of a write that already landed — a ledger
   * hiccup must never surface as a failed water log. Swallowed and logged, same
   * contract as `habits/service.ts`'s habit-XP grant.
   */
  try {
    await grantAwards(
      user.id,
      awardsForWaterEntry({ localDate: entry.localDate as LocalDate, totalMl, targetMl }),
    );
  } catch (error) {
    // A caller with no logger (only this file's tests, never the real route) must
    // still see this somewhere — grantAwards' own doc comment is explicit that a
    // failure like "no User document for this id" is deliberately loud, and a
    // silent swallow here would undo that.
    (logger ?? console).warn({ err: error }, 'failed to grant water XP');
  }

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

/** Exported for the same reason as `createEntry` — a test can drive real behaviour. */
export async function deleteEntry(user: AuthedUser, id: string): Promise<void> {
  const removed = await WaterEntryModel.findOneAndDelete({
    _id: new Types.ObjectId(id),
    userId: new Types.ObjectId(user.id),
  });

  if (!removed) throw AppError.notFound('Water entry');

  // The timeline is a projection — a mis-tapped glass must vanish from Today too.
  await retractByRef(user.id, id);
  await invalidateDailySummary(user.id, removed.localDate as LocalDate);
}

export async function registerWaterRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    '/water',
    {
      onRequest: [app.requireAuth],
      schema: { body: createWaterEntrySchema.and(clientIdSchema) },
    },
    async (req, reply) => {
      const result = await createEntry(req.user, req.body, req.log);
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
      await deleteEntry(req.user, req.params.id);
      return reply.status(204).send();
    },
  );
}
