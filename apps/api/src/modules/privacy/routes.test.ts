import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserModel } from '../../db/models.js';
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
      // Sign-in tokens are credentials. An export is a file a person may hand to someone else.
      .filter((name) => name !== 'RefreshToken')
      .filter((name) => !response.body.includes(`"mine:${name}"`));
    expect(missing).toEqual([]);

    expect(response.body).not.toContain('"mine:RefreshToken"');
    expect(response.body).not.toContain('"theirs:');
    expect(response.json().user.email).toBe(asking.email);
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
