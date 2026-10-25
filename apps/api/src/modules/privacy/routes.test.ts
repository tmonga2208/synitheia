import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { asLocalDate } from '@synitheia/shared';
import { UserModel, UserPreferenceModel } from '../../db/models.js';
import { buildContext } from '../../ai/context-builder.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import type * as Env from '../../config/env.js';
import type * as ImageKit from '../../storage/imagekit.js';
import { registerPrivacyRoutes } from './routes.js';

/**
 * Stored images live in ImageKit, which a test must not call. Everything else here is real:
 * a real MongoDB, the real routes, the real receipt purge.
 */
const deleteImage = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../storage/imagekit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageKit>()),
  deleteImage,
}));

// The routes read the environment once, for the ImageKit credentials the mock above replaces.
vi.mock('../../config/env.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Env>()),
  loadEnv: () => ({}),
}));

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  deleteImage.mockClear();
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});

/**
 * Every collection that holds something of a user's, found by asking the models themselves.
 *
 * This is the point of the file. Account deletion and the export were each a hand-written
 * list of collections, and each fell behind as collections were added: deleting an account
 * left daily health records, subscriptions, categories and the XP ledger on the server. A
 * list in a test would fall behind the same way, so there is no list here.
 */
const userCollections = () =>
  Object.values(mongoose.models).filter((model) => model.schema.path('userId') !== undefined);

interface Seeded extends AuthedUser {
  email: string;
  oid: Types.ObjectId;
}

async function seedUser(): Promise<Seeded> {
  const email = `${new Types.ObjectId().toString()}@example.com`;
  const user = await UserModel.create({
    email,
    name: 'Test User',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  });
  return { id: user._id.toString(), oid: user._id, email, timezone: 'Asia/Kolkata', currency: 'INR' };
}

/**
 * One document in every user collection, written past the schemas on purpose: the question
 * is whether a row is found by its user id, not whether it is a well-formed row.
 */
async function seedEverything(user: Seeded, marker: (modelName: string) => string) {
  for (const model of userCollections()) {
    const row: Record<string, unknown> = { userId: user.oid, marker: marker(model.modelName) };

    // Two users' rows must not collide on a unique index (a token hash, a dedupe key).
    for (const [fields, options] of model.schema.indexes()) {
      if (!options?.unique) continue;
      for (const field of Object.keys(fields)) {
        if (field !== 'userId') row[field] = new Types.ObjectId().toString();
      }
    }

    await model.collection.insertOne(row);
  }
}

async function appFor(user: AuthedUser) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    req.user = user;
  });
  await registerPrivacyRoutes(app);
  return app;
}

describe('DELETE /privacy/account', () => {
  it('leaves nothing that carries the user id, in any collection', async () => {
    const leaving = await seedUser();
    const staying = await seedUser();
    await seedEverything(leaving, (name) => `leaving:${name}`);
    await seedEverything(staying, (name) => `staying:${name}`);
    expect(userCollections().length).toBeGreaterThan(15);

    const app = await appFor(leaving);
    const response = await app.inject({
      method: 'DELETE',
      url: '/privacy/account',
      payload: { confirmEmail: leaving.email },
    });
    expect(response.statusCode).toBe(204);

    const leftBehind: string[] = [];
    for (const model of userCollections()) {
      if ((await model.countDocuments({ userId: leaving.oid })) > 0) leftBehind.push(model.modelName);
    }
    expect(leftBehind).toEqual([]);
    expect(await UserModel.findById(leaving.oid)).toBeNull();

    // Someone else's data is not this request's to touch.
    for (const model of userCollections()) {
      expect(await model.countDocuments({ userId: staying.oid }), model.modelName).toBe(1);
    }
    expect(await UserModel.findById(staying.oid)).not.toBeNull();
  });

  it('removes the stored receipt images, not only the rows that pointed at them', async () => {
    const leaving = await seedUser();
    await mongoose.models.Receipt!.collection.insertOne({ userId: leaving.oid, fileId: 'file_abc' });

    const app = await appFor(leaving);
    await app.inject({
      method: 'DELETE',
      url: '/privacy/account',
      payload: { confirmEmail: leaving.email },
    });

    expect(deleteImage).toHaveBeenCalledTimes(1);
    expect(deleteImage).toHaveBeenCalledWith(expect.anything(), 'file_abc');
  });
});

describe('GET /privacy/export', () => {
  it('carries every collection that holds the user’s data, and nobody else’s', async () => {
    const asking = await seedUser();
    const other = await seedUser();
    await seedEverything(asking, (name) => `mine:${name}`);
    await seedEverything(other, (name) => `theirs:${name}`);

    const app = await appFor(asking);
    const response = await app.inject({ method: 'GET', url: '/privacy/export' });
    expect(response.statusCode).toBe(200);

    const missing = userCollections()
      .map((model) => model.modelName)
      // Sign-in tokens and reset codes are credentials. An export is a file a person may
      // hand to someone else.
      .filter((name) => name !== 'RefreshToken' && name !== 'PasswordReset')
      .filter((name) => !response.body.includes(`"mine:${name}"`));
    expect(missing).toEqual([]);

    expect(response.body).not.toContain('"mine:RefreshToken"');
    expect(response.body).not.toContain('"mine:PasswordReset"');
    expect(response.body).not.toContain('"theirs:');
    expect(response.json().user.email).toBe(asking.email);
  });
});

describe('GET /data-sources', () => {
  /**
   * The count under each source was a counter kept beside the events: Health never added to
   * it, so it read 0 however much arrived, and Weather added one per sync although a day
   * keeps one observation. The count is the events, as the timeline and a deletion see them.
   */
  it('counts each source’s events as the timeline holds them', async () => {
    const user = await seedUser();
    const other = await seedUser();
    const event = (owner: Seeded, source: string) => ({
      userId: owner.oid,
      source,
      dedupeKey: new Types.ObjectId().toString(),
    });
    await mongoose.models.PersonalEvent!.collection.insertMany([
      event(user, 'health'),
      event(user, 'health'),
      event(user, 'health'),
      event(user, 'weather'),
      event(other, 'health'),
      event(other, 'calendar'),
    ]);
    // What the old counters said for this user.
    await mongoose.models.DataSourceConnection!.collection.insertMany([
      { userId: user.oid, source: 'health', status: 'connected', eventCount: 0 },
      { userId: user.oid, source: 'weather', status: 'connected', eventCount: 99 },
    ]);

    const app = await appFor(user);
    const response = await app.inject({ method: 'GET', url: '/data-sources' });
    expect(response.statusCode).toBe(200);

    const counts = Object.fromEntries(
      response
        .json()
        .items.map((item: { source: string; eventCount: number }) => [item.source, item.eventCount]),
    );
    expect(counts).toEqual({ health: 3, calendar: 0, location: 0, weather: 1, notifications: 0 });
  });
});

describe('DELETE /data-sources/:source/data', () => {
  it('forgets the daily health records along with the health events', async () => {
    const user = await seedUser();
    await mongoose.models.HealthDay!.collection.insertOne({ userId: user.oid });
    await mongoose.models.PersonalEvent!.collection.insertMany([
      { userId: user.oid, source: 'health', dedupeKey: 'a' },
      { userId: user.oid, source: 'calendar', dedupeKey: 'b' },
    ]);

    const app = await appFor(user);
    const response = await app.inject({ method: 'DELETE', url: '/data-sources/health/data' });
    expect(response.statusCode).toBe(200);

    expect(await mongoose.models.HealthDay!.countDocuments({ userId: user.oid })).toBe(0);
    expect(await mongoose.models.PersonalEvent!.countDocuments({ userId: user.oid, source: 'health' })).toBe(0);
    // Forgetting one source is not forgetting the others.
    expect(await mongoose.models.PersonalEvent!.countDocuments({ userId: user.oid, source: 'calendar' })).toBe(1);
  });

  it('keeps the daily health records when a different source is forgotten', async () => {
    const user = await seedUser();
    await mongoose.models.HealthDay!.collection.insertOne({ userId: user.oid });

    const app = await appFor(user);
    await app.inject({ method: 'DELETE', url: '/data-sources/calendar/data' });

    expect(await mongoose.models.HealthDay!.countDocuments({ userId: user.oid })).toBe(1);
  });
});

/**
 * The "Let Synítheia AI use it" switch on each source is a promise about what reaches the
 * model. These tests flip it through the routes the app calls, then ask the real context
 * builder what it would send.
 */
describe('per-source AI consent', () => {
  const WEEK = [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
  ];

  /** A week the builder will reason about: every day has activity, and every day has steps. */
  async function seedWeekWithSteps(user: Seeded) {
    await mongoose.models.DailySummary!.collection.insertMany(
      WEEK.map((localDate, i) => ({
        userId: user.oid,
        localDate,
        expenses: { totalMinor: 0, count: 0, byCategory: {} },
        habits: { completedIds: [], missedIds: [] },
        nutrition: { entryCount: 0, totals: { calories: 0 }, calorieTarget: 2000 },
        water: { entryCount: 0, totalMl: 0, targetMl: 2500 },
        activity: { steps: 8000 + i, workoutMinutes: 0 },
        context: { weekday: i, calendarEventCount: 0, lastCalendarEventEndMin: null },
        eventCount: 1,
        generatedAt: new Date(),
      })),
    );
  }

  async function stepsReachTheModel(user: Seeded): Promise<boolean> {
    const context = await buildContext(
      user.id,
      user.timezone,
      'INR',
      asLocalDate(WEEK[0]!),
      asLocalDate(WEEK[6]!),
    );
    return context.metrics.some((metric) => metric.key === 'steps_avg');
  }

  async function aiOnFor(user: Seeded) {
    await UserPreferenceModel.create({ userId: user.oid, aiEnabled: true });
    return appFor(user);
  }

  it('stops sending a source to the model once its AI switch is turned off', async () => {
    const user = await seedUser();
    const app = await aiOnFor(user);
    await seedWeekWithSteps(user);

    await app.inject({
      method: 'PUT',
      url: '/data-sources/health',
      payload: { status: 'connected', aiAllowed: true },
    });
    expect(await stepsReachTheModel(user)).toBe(true);

    // Collection stays on. Only the AI switch moves, which is all the app sends here.
    await app.inject({
      method: 'PUT',
      url: '/data-sources/health',
      payload: { status: 'connected', aiAllowed: false },
    });
    expect(await stepsReachTheModel(user)).toBe(false);
  });

  it('does not send a forgotten source to the model when it is collected again', async () => {
    const user = await seedUser();
    const app = await aiOnFor(user);

    await app.inject({
      method: 'PUT',
      url: '/data-sources/health',
      payload: { status: 'connected', aiAllowed: true },
    });
    await app.inject({ method: 'DELETE', url: '/data-sources/health/data' });

    // Turning collection back on sends the AI switch as the screen now shows it: off.
    await app.inject({
      method: 'PUT',
      url: '/data-sources/health',
      payload: { status: 'connected', aiAllowed: false },
    });
    await seedWeekWithSteps(user);

    expect(await stepsReachTheModel(user)).toBe(false);
  });

  /**
   * The preferences carry a copy of the per-source choice, and the export hands it to the
   * user as "what you allowed the AI". It has to say what the switches say.
   */
  it('exports the AI choices the switches show, not stale ones', async () => {
    const user = await seedUser();
    const app = await aiOnFor(user);
    const exportedChoice = async () =>
      (await app.inject({ method: 'GET', url: '/privacy/export' })).json().preferences
        .aiAllowedSources;

    for (const source of ['health', 'calendar', 'location']) {
      await app.inject({
        method: 'PUT',
        url: `/data-sources/${source}`,
        payload: { status: 'connected', aiAllowed: true },
      });
    }
    expect([...(await exportedChoice())].sort()).toEqual(['calendar', 'health', 'location']);

    await app.inject({
      method: 'PUT',
      url: '/data-sources/health',
      payload: { status: 'connected', aiAllowed: false },
    });
    await app.inject({ method: 'DELETE', url: '/data-sources/calendar/data' });
    expect(await exportedChoice()).toEqual(['location']);

    // Nor can the list be written directly to say something no switch says.
    await app.inject({
      method: 'PUT',
      url: '/privacy/ai',
      payload: { aiEnabled: true, aiAllowedSources: ['health', 'weather'] },
    });
    expect(await exportedChoice()).toEqual(['location']);
  });
});
