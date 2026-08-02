import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { XpAward } from '@synitheia/shared';
import { UserModel, XpAwardModel } from '../../db/models.js';
import { grantAwards } from './service.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await XpAwardModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await XpAwardModel.deleteMany({});
  await UserModel.deleteMany({});
});

async function seedUser(): Promise<string> {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test User',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  });
  return user._id.toString();
}

describe('grantAwards', () => {
  it('grants two distinct awards, inserting two rows and moving user.xp by their sum', async () => {
    const userId = await seedUser();
    const awards: XpAward[] = [
      { key: 'habit:h1:2026-07-18', amount: 5 },
      { key: 'day:2026-07-18', amount: 10 },
    ];

    const delta = await grantAwards(userId, awards);

    expect(delta).toBe(15);
    expect(await XpAwardModel.countDocuments({ userId: new Types.ObjectId(userId) })).toBe(2);
    const user = await UserModel.findById(userId);
    expect(user?.xp).toBe(15);
  });

  it('granting the same award twice inserts one row and moves user.xp once', async () => {
    const userId = await seedUser();
    const award: XpAward = { key: 'habit:h1:2026-07-18', amount: 5 };

    const first = await grantAwards(userId, [award]);
    const second = await grantAwards(userId, [award]);

    expect(first).toBe(5);
    expect(second).toBe(0);
    expect(await XpAwardModel.countDocuments({ userId: new Types.ObjectId(userId) })).toBe(1);
    const user = await UserModel.findById(userId);
    expect(user?.xp).toBe(5);
  });

  it('a mixed batch with one new key and one duplicate key grants only the new amount', async () => {
    const userId = await seedUser();
    const existing: XpAward = { key: 'habit:h1:2026-07-18', amount: 5 };
    await grantAwards(userId, [existing]);

    const newAward: XpAward = { key: 'day:2026-07-18', amount: 10 };
    const delta = await grantAwards(userId, [existing, newAward]);

    expect(delta).toBe(10);
    expect(await XpAwardModel.countDocuments({ userId: new Types.ObjectId(userId) })).toBe(2);
    const user = await UserModel.findById(userId);
    expect(user?.xp).toBe(15);
  });

  it('is a no-op on an empty award list', async () => {
    const userId = await seedUser();

    const delta = await grantAwards(userId, []);

    expect(delta).toBe(0);
    expect(await XpAwardModel.countDocuments({ userId: new Types.ObjectId(userId) })).toBe(0);
    const user = await UserModel.findById(userId);
    expect(user?.xp).toBe(0);
  });

  it('lets two users hold the same key independently', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const award: XpAward = { key: 'habit:h1:2026-07-18', amount: 5 };

    const deltaA = await grantAwards(userA, [award]);
    const deltaB = await grantAwards(userB, [award]);

    expect(deltaA).toBe(5);
    expect(deltaB).toBe(5);
    expect(await XpAwardModel.countDocuments({ userId: new Types.ObjectId(userA) })).toBe(1);
    expect(await XpAwardModel.countDocuments({ userId: new Types.ObjectId(userB) })).toBe(1);
    expect((await UserModel.findById(userA))?.xp).toBe(5);
    expect((await UserModel.findById(userB))?.xp).toBe(5);
  });

  it('returns exactly the delta actually applied to user.xp', async () => {
    const userId = await seedUser();
    await grantAwards(userId, [{ key: 'streak:h1:7', amount: 25 }]);

    const before = (await UserModel.findById(userId))?.xp ?? 0;
    const delta = await grantAwards(userId, [
      { key: 'streak:h1:7', amount: 25 }, // duplicate — no-op
      { key: 'streak:h1:30', amount: 100 }, // new
    ]);
    const after = (await UserModel.findById(userId))?.xp ?? 0;

    expect(delta).toBe(100);
    expect(after - before).toBe(delta);
  });
});
