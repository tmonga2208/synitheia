import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UserModel, XpAwardModel } from '../db/models.js';
import { recomputeXp } from './recompute-xp.js';

/**
 * The spec's central claim is that `user.xp` is a CACHE of the ledger's sum, recomputable
 * from it — and that this is what separates it from the bare `$inc` counter
 * `nutrition/service.ts` warns about ("The tempting alternative … drifts"). The ledger is
 * retained, so the information exists; without something that actually re-derives the
 * total, the claim is aspirational rather than true.
 *
 * Drift is not hypothetical. `grantAwards` commits ledger rows one at a time and applies
 * a single `$inc` at the end, so a transient failure on insert 2 of 3 leaves award 1
 * ledgered with no increment — and its own doc comment assigns the self-healing property
 * to a caller that retries the SAME batch, which none of the call sites do. The next log
 * offers a different batch, award 1 collides on 11000, and that XP is missing from the
 * cache permanently. This is the repair.
 */

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
  await Promise.all([XpAwardModel.deleteMany({}), UserModel.deleteMany({})]);
});

async function seedUser(xp: number): Promise<string> {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test User',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    xp,
  });
  return user._id.toString();
}

async function seedAward(userId: string, key: string, amount: number) {
  await XpAwardModel.create({ userId: new Types.ObjectId(userId), key, amount });
}

describe('recomputeXp', () => {
  it('repairs a total that drifted below the ledger', async () => {
    // The exact shape of a partial-batch failure: three awards ledgered, only one
    // increment ever applied.
    const userId = await seedUser(5);
    await seedAward(userId, 'habit:h1:2026-07-18', 5);
    await seedAward(userId, 'day:2026-07-18', 10);
    await seedAward(userId, 'streak:h1:7', 25);

    const report = await recomputeXp();

    expect((await UserModel.findById(userId))?.xp).toBe(40);
    expect(report.corrected).toBe(1);
    expect(report.drift).toEqual([{ userId, was: 5, now: 40 }]);
  });

  it('leaves a total that already agrees with the ledger alone', async () => {
    const userId = await seedUser(15);
    await seedAward(userId, 'habit:h1:2026-07-18', 5);
    await seedAward(userId, 'day:2026-07-18', 10);

    const report = await recomputeXp();

    expect((await UserModel.findById(userId))?.xp).toBe(15);
    expect(report.checked).toBe(1);
    expect(report.corrected).toBe(0);
    expect(report.drift).toEqual([]);
  });

  it('a user with no ledger rows is set back to zero — the ledger is the truth, and an unbacked total is drift too', async () => {
    const userId = await seedUser(70);

    const report = await recomputeXp();

    expect((await UserModel.findById(userId))?.xp).toBe(0);
    expect(report.corrected).toBe(1);
  });

  it('sums each user against their own ledger only', async () => {
    const userA = await seedUser(0);
    const userB = await seedUser(0);
    await seedAward(userA, 'habit:h1:2026-07-18', 5);
    await seedAward(userB, 'habit:h1:2026-07-18', 5);
    await seedAward(userB, 'day:2026-07-18', 10);

    await recomputeXp();

    expect((await UserModel.findById(userA))?.xp).toBe(5);
    expect((await UserModel.findById(userB))?.xp).toBe(15);
  });

  it('scoped to one email, touches only that user', async () => {
    const userA = await seedUser(0);
    const userB = await seedUser(999);
    await seedAward(userA, 'habit:h1:2026-07-18', 5);
    await seedAward(userB, 'habit:h1:2026-07-18', 5);

    const a = await UserModel.findById(userA).lean();
    const report = await recomputeXp(a!.email);

    expect(report.checked).toBe(1);
    expect((await UserModel.findById(userA))?.xp).toBe(5);
    // Untouched, drift and all — a scoped repair must not quietly fix its neighbours.
    expect((await UserModel.findById(userB))?.xp).toBe(999);
  });

  it('throws rather than silently doing nothing when the email matches no user', async () => {
    await expect(recomputeXp('nobody@example.com')).rejects.toThrow('nobody@example.com');
  });
});
