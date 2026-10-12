import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UserModel } from '../db/models.js';
import { deleteOrphans, findOrphans, purgeOrphans } from './purge-orphans.js';

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
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});

const userCollections = () =>
  Object.values(mongoose.models).filter((model) => model.schema.path('userId') !== undefined);

async function seedUser(): Promise<Types.ObjectId> {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test User',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  });
  return user._id;
}

/** One row in every user collection, unique where an index demands it. */
async function seedRows(userId: Types.ObjectId) {
  for (const model of userCollections()) {
    const row: Record<string, unknown> = { userId };
    for (const [fields, options] of model.schema.indexes()) {
      if (!options?.unique) continue;
      for (const field of Object.keys(fields)) {
        if (field !== 'userId') row[field] = new Types.ObjectId().toString();
      }
    }
    await model.collection.insertOne(row);
  }
}

const rowsOf = async (userId: Types.ObjectId) => {
  let total = 0;
  for (const model of userCollections()) total += await model.countDocuments({ userId });
  return total;
};

describe('purgeOrphans', () => {
  it('reports what a deleted account left behind, and deletes nothing unless told to', async () => {
    const living = await seedUser();
    const gone = new Types.ObjectId();
    await seedRows(living);
    await seedRows(gone);
    const collections = userCollections().length;

    const report = await purgeOrphans({ apply: false });

    expect(report.applied).toBe(false);
    expect(report.rows).toBe(collections);
    expect(report.accounts).toBe(1);
    expect(report.collections).toHaveLength(collections);
    expect(report.collections.every((entry) => entry.rows === 1)).toBe(true);
    expect(await rowsOf(gone)).toBe(collections);
  });

  it('deletes the leftovers when told to, and nothing that belongs to a living account', async () => {
    const living = await seedUser();
    const gone = new Types.ObjectId();
    await seedRows(living);
    await seedRows(gone);
    const collections = userCollections().length;

    const report = await purgeOrphans({ apply: true });

    expect(report.applied).toBe(true);
    expect(report.rows).toBe(collections);
    expect(await rowsOf(gone)).toBe(0);
    expect(await rowsOf(living)).toBe(collections);
    expect(await UserModel.countDocuments({})).toBe(1);
  });

  it('finds nothing to do in a database with no leftovers', async () => {
    await seedRows(await seedUser());

    const report = await purgeOrphans({ apply: true });

    expect(report).toEqual({ applied: true, accounts: 0, rows: 0, collections: [] });
  });

  it('spares an account that exists by the time its rows are about to be deleted', async () => {
    // Someone signing up while this runs: their rows are seen before their account is.
    const arriving = new Types.ObjectId();
    await seedRows(arriving);

    const candidates = await findOrphans();
    expect(candidates.found.length).toBe(userCollections().length);

    await UserModel.collection.insertOne({ _id: arriving, email: 'late@example.com' });
    const report = await deleteOrphans(candidates, { apply: true });

    expect(report.rows).toBe(0);
    expect(report.accounts).toBe(0);
    expect(await rowsOf(arriving)).toBe(userCollections().length);
  });
});
