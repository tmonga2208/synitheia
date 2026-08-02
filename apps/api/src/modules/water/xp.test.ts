import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { XP_AMOUNTS, todayLocalDate } from '@synitheia/shared';
import { UserModel, UserPreferenceModel, WaterEntryModel, XpAwardModel } from '../../db/models.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { createEntry, deleteEntry } from './routes.js';

let mongo: MongoMemoryReplSet;

const IST = 'Asia/Kolkata';

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([XpAwardModel.syncIndexes(), WaterEntryModel.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all([
    WaterEntryModel.deleteMany({}),
    XpAwardModel.deleteMany({}),
    UserModel.deleteMany({}),
    UserPreferenceModel.deleteMany({}),
  ]);
});

async function seedUser(): Promise<AuthedUser> {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test User',
    timezone: IST,
    currency: 'INR',
  });
  return { id: user._id.toString(), timezone: IST, currency: 'INR' };
}

/** A small target keeps each test's glass count low while still crossing/not-crossing it. */
async function seedTarget(userId: string, waterTargetMl: number) {
  await UserPreferenceModel.create({
    userId: new Types.ObjectId(userId),
    waterTargetMl,
  });
}

describe('createEntry — XP wiring', () => {
  it('grants waterTarget once when the day crosses the target', async () => {
    const user = await seedUser();
    await seedTarget(user.id, 1000);

    await createEntry(user, { amountMl: 1000 });

    const stored = await UserModel.findById(user.id);
    expect(stored?.xp).toBe(XP_AMOUNTS.waterTarget);

    const today = todayLocalDate(IST);
    const award = await XpAwardModel.findOne({
      userId: new Types.ObjectId(user.id),
      key: `water:${today}`,
    });
    expect(award?.amount).toBe(XP_AMOUNTS.waterTarget);
  });

  it('a further glass the same day grants nothing more', async () => {
    const user = await seedUser();
    await seedTarget(user.id, 1000);

    await createEntry(user, { amountMl: 1000 });
    const afterFirst = (await UserModel.findById(user.id))?.xp;

    await createEntry(user, { amountMl: 200 });
    const afterSecond = (await UserModel.findById(user.id))?.xp;

    expect(afterFirst).toBe(XP_AMOUNTS.waterTarget);
    expect(afterSecond).toBe(afterFirst);

    const today = todayLocalDate(IST);
    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: `water:${today}`,
      }),
    ).toBe(1);
  });

  it('staying below the target grants nothing', async () => {
    const user = await seedUser();
    await seedTarget(user.id, 1000);

    await createEntry(user, { amountMl: 200 });

    const stored = await UserModel.findById(user.id);
    expect(stored?.xp).toBe(0);

    const today = todayLocalDate(IST);
    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: `water:${today}`,
      }),
    ).toBe(0);
  });

  it('deleting a glass does not revoke the award', async () => {
    const user = await seedUser();
    await seedTarget(user.id, 1000);

    const { entry } = await createEntry(user, { amountMl: 1000 });
    const afterGrant = (await UserModel.findById(user.id))?.xp;
    expect(afterGrant).toBe(XP_AMOUNTS.waterTarget);

    await deleteEntry(user, entry._id.toString());

    const afterDelete = (await UserModel.findById(user.id))?.xp;
    expect(afterDelete).toBe(afterGrant); // never revoked

    const today = todayLocalDate(IST);
    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: `water:${today}`,
      }),
    ).toBe(1);
  });

  it('never fails the water log when granting XP throws', async () => {
    const user = await seedUser();
    await seedTarget(user.id, 1000);

    // Delete the user out from under the grant so grantAwards throws — the
    // water log must still succeed.
    await UserModel.deleteOne({ _id: new Types.ObjectId(user.id) });

    await expect(createEntry(user, { amountMl: 1000 })).resolves.toMatchObject({
      totalMl: 1000,
      targetMl: 1000,
    });
  });
});
