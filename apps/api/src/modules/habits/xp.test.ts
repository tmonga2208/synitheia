import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { XP_AMOUNTS, todayLocalDate } from '@synitheia/shared';
import { HabitLogModel, HabitModel, UserModel, XpAwardModel } from '../../db/models.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { logHabit } from './service.js';

let mongo: MongoMemoryReplSet;

const IST = 'Asia/Kolkata';

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([XpAwardModel.syncIndexes(), HabitLogModel.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([
    HabitModel.deleteMany({}),
    HabitLogModel.deleteMany({}),
    XpAwardModel.deleteMany({}),
    UserModel.deleteMany({}),
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

async function seedHabit(userId: string, targetCount = 1) {
  return HabitModel.create({
    userId: new Types.ObjectId(userId),
    name: 'Push-ups',
    icon: 'dumbbell',
    color: '#7D927D',
    frequency: 'daily',
    measure: 'count',
    targetCount,
  });
}

describe('logHabit — XP wiring', () => {
  it('grants habitComplete on completion', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id);

    await logHabit(user, habit._id.toString(), { count: 1 });

    // The only habit scheduled today is now complete, so the day bonus lands too.
    const stored = await UserModel.findById(user.id);
    expect(stored?.xp).toBe(XP_AMOUNTS.habitComplete + XP_AMOUNTS.dayComplete);

    const award = await XpAwardModel.findOne({
      userId: new Types.ObjectId(user.id),
      key: `habit:${habit._id.toString()}:${todayLocalDate(IST)}`,
    });
    expect(award?.amount).toBe(XP_AMOUNTS.habitComplete);
  });

  it('logging the same completion twice moves the total once', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id);

    await logHabit(user, habit._id.toString(), { count: 1 });
    const afterFirst = (await UserModel.findById(user.id))?.xp;

    await logHabit(user, habit._id.toString(), { count: 1 });
    const afterSecond = (await UserModel.findById(user.id))?.xp;

    // Single habit, so completing it also completes the day.
    expect(afterFirst).toBe(XP_AMOUNTS.habitComplete + XP_AMOUNTS.dayComplete);
    expect(afterSecond).toBe(afterFirst);
  });

  it('un-completing then re-completing grants nothing further', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id, 2);

    await logHabit(user, habit._id.toString(), { count: 2 }); // complete
    const afterComplete = (await UserModel.findById(user.id))?.xp;
    // Single habit, so completing it also completes the day.
    expect(afterComplete).toBe(XP_AMOUNTS.habitComplete + XP_AMOUNTS.dayComplete);

    await logHabit(user, habit._id.toString(), { count: 0 }); // un-complete
    const afterUncomplete = (await UserModel.findById(user.id))?.xp;
    expect(afterUncomplete).toBe(afterComplete); // never revoked

    await logHabit(user, habit._id.toString(), { count: 2 }); // re-complete
    const afterRecomplete = (await UserModel.findById(user.id))?.xp;
    expect(afterRecomplete).toBe(afterComplete); // never re-earned
  });

  it('adds the day bonus only when the last outstanding habit is completed', async () => {
    const user = await seedUser();
    const habitA = await seedHabit(user.id);
    const habitB = await seedHabit(user.id);
    const today = todayLocalDate(IST);

    await logHabit(user, habitA._id.toString(), { count: 1 });

    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: `day:${today}`,
      }),
    ).toBe(0);
    let xp = (await UserModel.findById(user.id))?.xp;
    expect(xp).toBe(XP_AMOUNTS.habitComplete);

    await logHabit(user, habitB._id.toString(), { count: 1 });

    const dayAward = await XpAwardModel.findOne({
      userId: new Types.ObjectId(user.id),
      key: `day:${today}`,
    });
    expect(dayAward?.amount).toBe(XP_AMOUNTS.dayComplete);

    xp = (await UserModel.findById(user.id))?.xp;
    expect(xp).toBe(XP_AMOUNTS.habitComplete * 2 + XP_AMOUNTS.dayComplete);
  });

  it('grants the 7-day streak milestone once, and a further completion at streak 8 grants nothing more', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id);
    const today = todayLocalDate(IST);

    // Backdate 6 consecutive completed days immediately before today.
    for (let i = 6; i >= 1; i--) {
      const localDate = addDays(today, -i);
      await HabitLogModel.create({
        userId: new Types.ObjectId(user.id),
        habitId: habit._id,
        localDate,
        count: 1,
        targetCount: 1,
        completedAt: new Date(),
        source: 'manual',
      });
    }

    // Day 7 — today.
    await logHabit(user, habit._id.toString(), { count: 1 });

    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: `streak:${habit._id.toString()}:7`,
      }),
    ).toBe(1);

    // Extend the run one more day further back, then re-log today (a no-op on the
    // count itself) purely to trigger a fresh recompute — the streak is now 8.
    await HabitLogModel.create({
      userId: new Types.ObjectId(user.id),
      habitId: habit._id,
      localDate: addDays(today, -7),
      count: 1,
      targetCount: 1,
      completedAt: new Date(),
      source: 'manual',
    });

    await logHabit(user, habit._id.toString(), { count: 1 }); // still today, but streak is now 8

    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: `streak:${habit._id.toString()}:7`,
      }),
    ).toBe(1); // unchanged — not re-granted
    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: `streak:${habit._id.toString()}:30`,
      }),
    ).toBe(0); // 8 < 30, never offered
  });

  it('keys a completion at 23:30 UTC — already past midnight in Asia/Kolkata — to the user\'s local date, not the UTC date', async () => {
    vi.useFakeTimers();
    // 2026-07-18T23:30:00Z is 2026-07-19T05:00 in Asia/Kolkata (UTC+5:30) — the
    // UTC calendar date and the user's local calendar date disagree at this instant.
    vi.setSystemTime(new Date('2026-07-18T23:30:00.000Z'));

    const user = await seedUser();
    const habit = await seedHabit(user.id);

    const { log } = await logHabit(user, habit._id.toString(), { count: 1 });

    expect(log.localDate).toBe('2026-07-19');
    const award = await XpAwardModel.findOne({
      userId: new Types.ObjectId(user.id),
      key: `habit:${habit._id.toString()}:2026-07-19`,
    });
    expect(award).toBeTruthy();
  });

  it('never fails the habit log when granting XP throws', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id);

    // Delete the user out from under the grant so grantAwards throws — the
    // habit tap must still succeed.
    await UserModel.deleteOne({ _id: new Types.ObjectId(user.id) });

    await expect(
      logHabit(user, habit._id.toString(), { count: 1 }),
    ).resolves.toMatchObject({ log: { count: 1 } });
  });
});

function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
