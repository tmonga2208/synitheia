import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { monthSummaryResponseSchema } from '@synitheia/shared';
import { DailySummaryModel, UserModel, UserPreferenceModel } from '../../db/models.js';
import { monthSummaryFor } from './routes.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    DailySummaryModel.syncIndexes(),
    UserModel.syncIndexes(),
    UserPreferenceModel.syncIndexes(),
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all([
    DailySummaryModel.deleteMany({}),
    UserModel.deleteMany({}),
    UserPreferenceModel.deleteMany({}),
  ]);
});

const IST = 'Asia/Kolkata';

async function makeUser(createdAt = new Date('2026-03-14T06:00:00Z')) {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test',
    timezone: IST,
    passwordHash: 'x',
  });
  // `timestamps: true` sets createdAt on insert, so override it explicitly. Mongoose
  // treats `createdAt` from the timestamps plugin as immutable on updates (silently
  // dropping it from `$set` — see applyTimestampsToUpdate), so `overwriteImmutable`
  // is required for this override to actually take effect.
  await UserModel.updateOne(
    { _id: user._id },
    { $set: { createdAt } },
    { overwriteImmutable: true },
  );
  return { id: user._id.toString(), timezone: IST };
}

async function seedDay(
  userId: string,
  localDate: string,
  opts: {
    scheduled?: number;
    completionRate?: number;
    waterMl?: number;
    waterEntries?: number;
    calories?: number;
    foodEntries?: number;
    eventCount?: number;
  } = {},
) {
  await DailySummaryModel.create({
    userId: new Types.ObjectId(userId),
    localDate,
    expenses: { totalMinor: 0, count: 0, byCategory: {}, largestMinor: null },
    habits: {
      scheduled: opts.scheduled ?? 2,
      completed: 0,
      completionRate: opts.completionRate ?? 1,
      completedIds: [],
      missedIds: [],
    },
    nutrition: {
      totals: { calories: opts.calories ?? 0, proteinG: 0, carbsG: 0, fatG: 0 },
      entryCount: opts.foodEntries ?? 0,
      calorieTarget: 2000,
    },
    water: {
      totalMl: opts.waterMl ?? 0,
      targetMl: 2500,
      entryCount: opts.waterEntries ?? 0,
    },
    activity: { steps: null, workoutMinutes: null, sleepMinutes: null },
    context: {
      weekday: 0,
      calendarEventCount: 0,
      lastCalendarEventEndMin: null,
      weatherCondition: null,
    },
    eventCount: opts.eventCount ?? 3,
    sources: [],
    generatedAt: new Date(),
  });
}

describe('monthSummaryFor', () => {
  it('returns a payload matching the wire contract', async () => {
    const user = await makeUser();
    await seedDay(user.id, '2026-07-18');

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(() => monthSummaryResponseSchema.parse(result)).not.toThrow();
    expect(result.month).toBe('2026-07');
  });

  it('omits days with no summary rather than reporting them as zero', async () => {
    const user = await makeUser();
    await seedDay(user.id, '2026-07-18');
    await seedDay(user.id, '2026-07-20');

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(result.days.map((d) => d.localDate)).toEqual(['2026-07-18', '2026-07-20']);
    expect(result.days.some((d) => d.localDate === '2026-07-19')).toBe(false);
  });

  it('scores each day with the shared flow computation', async () => {
    const user = await makeUser();
    // habits 100, water 50, nutrition inactive (no entries) -> 75
    await seedDay(user.id, '2026-07-18', {
      completionRate: 1,
      waterMl: 1250,
      waterEntries: 2,
    });

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(result.days[0]?.percent).toBe(75);
  });

  it('excludes domains the user does not track', async () => {
    const user = await makeUser();
    await UserPreferenceModel.create({
      userId: new Types.ObjectId(user.id),
      trackedDomains: ['habits'],
    });
    // Water at 0 would drag this down if it counted.
    await seedDay(user.id, '2026-07-18', {
      completionRate: 1,
      waterMl: 0,
      waterEntries: 4,
    });

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(result.days[0]?.percent).toBe(100);
  });

  it('never returns a day in the future', async () => {
    const user = await makeUser();
    await seedDay(user.id, '2026-07-18');
    await seedDay(user.id, '2026-07-30'); // after the "today" we pass in

    const result = await monthSummaryFor(user, '2026-07', '2026-07-20');

    expect(result.days.map((d) => d.localDate)).toEqual(['2026-07-18']);
  });

  it('reports account creation, in the user timezone, as the earliest date', async () => {
    // 2026-03-13T20:00Z is already the 14th in IST (+5:30).
    const user = await makeUser(new Date('2026-03-13T20:00:00Z'));

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(result.earliestLocalDate).toBe('2026-03-14');
  });

  it('returns an empty month rather than an error for a month with no data', async () => {
    const user = await makeUser();

    const result = await monthSummaryFor(user, '2026-05', '2026-08-01');

    expect(result.days).toEqual([]);
    expect(result.stats).toEqual({ avgPercent: 0, daysLogged: 0, bestFlowRun: 0 });
  });

  it('does not leak another user’s days', async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    await seedDay(theirs.id, '2026-07-18');

    const result = await monthSummaryFor(mine, '2026-07', '2026-08-01');

    expect(result.days).toEqual([]);
  });

  it('computes stats over the returned days', async () => {
    const user = await makeUser();
    await seedDay(user.id, '2026-07-01', { completionRate: 1 }); // 100
    await seedDay(user.id, '2026-07-02', { completionRate: 1 }); // 100
    await seedDay(user.id, '2026-07-04', { completionRate: 0 }); // 0

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(result.stats).toEqual({ avgPercent: 67, daysLogged: 3, bestFlowRun: 2 });
  });
});
