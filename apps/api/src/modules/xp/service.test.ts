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

  /**
   * The property the whole feature turns on: the unique `{ userId, key }` index, not
   * call ordering, is what prevents the double-award. A regressed "findOne, then create
   * if absent" implementation would pass every test above unchanged — by the time a
   * second sequential `await` runs, the first row is already committed and a query finds
   * it just as reliably as the index would. Only concurrent, in-flight calls for the
   * same key expose the difference: under check-then-insert both calls can observe "not
   * found" before either commits, and both insert. This fires both calls at once and
   * asserts exactly one row and one increment survive.
   */
  it('two concurrent grants for the same key still produce exactly one row and one increment', async () => {
    const userId = await seedUser();
    const award: XpAward = { key: 'habit:h1:2026-07-18', amount: 5 };

    const [first, second] = await Promise.all([
      grantAwards(userId, [award]),
      grantAwards(userId, [award]),
    ]);

    // Exactly one of the two racing calls won the insert; the other saw 11000 and
    // granted nothing. Which one won is not deterministic, so only the pair is asserted.
    expect([first, second].sort((a, b) => a - b)).toEqual([0, 5]);
    expect(await XpAwardModel.countDocuments({ userId: new Types.ObjectId(userId) })).toBe(1);
    const user = await UserModel.findById(userId);
    expect(user?.xp).toBe(5);
  });

  it('throws rather than silently reporting a delta that never reached user.xp when the user does not exist', async () => {
    const missingUserId = new Types.ObjectId().toString();

    await expect(
      grantAwards(missingUserId, [{ key: 'habit:h1:2026-07-18', amount: 5 }]),
    ).rejects.toThrow(missingUserId);
  });
});

/**
 * `apps/api/src/index.ts` awaits `XpAwardModel.init()` before `app.listen()`, and that
 * one await is what stands between the ledger and a permanently unprotected collection:
 * Mongoose's `autoIndex` build is unawaited, so a duplicate landing inside the build
 * window fails the unique build with 11000 and leaves the index absent forever, signalled
 * only by an `'index'` event nothing listens for.
 *
 * `init()` is memoized — it hands back the promise of the build `autoIndex` already
 * started rather than kicking off a second one — which is precisely why awaiting it is
 * the right instrument: it turns a fire-and-forget build into one the boot waits on.
 * That also means the boot ordering itself is not reachable from a test; `main()` is not
 * exported, needs a live Mongo and a listening socket, and `init()` here would resolve
 * off the build this file's `beforeAll` already performed.
 *
 * What IS testable, and what the whole fix rests on, is that awaiting `init()` leaves an
 * index that actually REFUSES. If `unique: true` on `{ userId, key }` were ever dropped,
 * the boot await would still resolve cleanly and every `grantAwards` test above would
 * still pass — a `create` per key, no duplicates offered, nothing to collide. This is the
 * only test that would notice, and the double-award it guards has no user-visible symptom.
 */
describe('the XpAward unique index', () => {
  it('refuses a second row for the same { userId, key } once init() has resolved', async () => {
    await XpAwardModel.init();

    const userId = new Types.ObjectId();
    await XpAwardModel.create({ userId, key: 'habit:h1:2026-07-18', amount: 5 });

    await expect(
      XpAwardModel.create({ userId, key: 'habit:h1:2026-07-18', amount: 5 }),
    ).rejects.toMatchObject({ code: 11000 });

    expect(await XpAwardModel.countDocuments({ userId })).toBe(1);
  });
});
