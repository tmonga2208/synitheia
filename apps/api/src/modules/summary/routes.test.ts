import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { serializerCompiler } from 'fastify-type-provider-zod';
import { asLocalDate, monthSummaryResponseSchema } from '@synitheia/shared';
import {
  DailySummaryModel,
  HabitLogModel,
  HabitModel,
  PersonalEventModel,
  UserModel,
  UserPreferenceModel,
  WaterEntryModel,
} from '../../db/models.js';
import { logHabit } from '../habits/service.js';
import { createEntry } from '../water/routes.js';
import { monthSummaryFor } from './routes.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    DailySummaryModel.syncIndexes(),
    UserModel.syncIndexes(),
    UserPreferenceModel.syncIndexes(),
    HabitLogModel.syncIndexes(),
    PersonalEventModel.syncIndexes(),
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
    HabitModel.deleteMany({}),
    HabitLogModel.deleteMany({}),
    PersonalEventModel.deleteMany({}),
    WaterEntryModel.deleteMany({}),
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

/**
 * The route attaches `monthSummaryResponseSchema` as its response schema — the only
 * route in this API that does — so this proves the app's serializer actually accepts it
 * and enforces it. Without this, "the contract is checked" would rest on a type
 * annotation over `Schema.Types.Mixed`, which checks nothing.
 */
describe('the response schema is enforced at serialisation', () => {
  const serialize = serializerCompiler({
    // The compiler only reads `schema` and `method`/`url` for error messages.
    schema: monthSummaryResponseSchema,
    method: 'GET',
    url: '/summary/month',
    httpStatus: '200',
  } as Parameters<typeof serializerCompiler>[0]);

  it('serialises a well-formed payload', () => {
    const body = JSON.parse(
      serialize({
        month: '2026-07',
        earliestLocalDate: '2026-03-14',
        days: [{ localDate: '2026-07-18', percent: 82, eventCount: 7 }],
        stats: { avgPercent: 82, daysLogged: 1, bestFlowRun: 1 },
      }),
    ) as { days: { percent: number }[] };

    expect(body.days[0]?.percent).toBe(82);
  });

  it('throws rather than shipping a NaN percent as null', () => {
    expect(() =>
      serialize({
        month: '2026-07',
        earliestLocalDate: '2026-03-14',
        // What a renamed aggregator field produces: NaN out of the arithmetic, which
        // JSON.stringify turns into null and the grid renders as the wrong tint.
        days: [{ localDate: '2026-07-18', percent: Number.NaN, eventCount: 7 }],
        stats: { avgPercent: 82, daysLogged: 1, bestFlowRun: 1 },
      }),
    ).toThrow();
  });
});

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

  /**
   * Every test above seeds DailySummaryModel by hand, which is exactly why the endpoint
   * shipped treating a cache MISS as "nothing logged". `getSummariesBetween` is a plain
   * find() — it never builds — so `days` was "days that happen to have a cached rollup",
   * not "days with data". Aggressive invalidation (a 7-day health sync, an edited expense
   * on an old date) then deleted rollups the Today route only rebuilds for the current
   * week, and a fully-logged past week rendered hollow.
   *
   * These tests drive real services and seed NOTHING into DailySummaryModel.
   */
  describe('without a cached rollup', () => {
    const authed = (user: { id: string; timezone: string }) => ({
      ...user,
      currency: 'INR',
    });

    async function makeHabit(userId: string, createdAt: Date) {
      const habit = await HabitModel.create({
        userId: new Types.ObjectId(userId),
        name: 'Push-ups',
        icon: 'dumbbell',
        color: '#7D927D',
        frequency: 'daily',
        measure: 'count',
        targetCount: 20,
      });
      // scheduledOn() excludes a habit created after the day, so a habit created "now"
      // would not be scheduled on a July date and the day would score 0 for the wrong
      // reason. Same overwriteImmutable dance as makeUser.
      await HabitModel.updateOne(
        { _id: habit._id },
        { $set: { createdAt } },
        { overwriteImmutable: true },
      );
      return habit._id.toString();
    }

    it('builds a missing rollup for a day the user really logged a habit on', async () => {
      const user = await makeUser();
      const habitId = await makeHabit(user.id, new Date('2026-07-01T00:00:00Z'));

      await logHabit(authed(user), habitId, {
        localDate: asLocalDate('2026-07-18'),
        count: 20,
      });

      // Nothing seeded the cache, and logHabit invalidates rather than rebuilds.
      expect(await DailySummaryModel.countDocuments({})).toBe(0);

      // A backdated completion now lands on its own day's timeline. Remove it, so this
      // day can only be found by the HabitLog scan, which is what this test is for.
      await PersonalEventModel.deleteMany({});

      const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

      // Habits are the only active component: 1 of 1 completed, and no timeline events.
      expect(result.days).toEqual([
        { localDate: '2026-07-18', percent: 100, eventCount: 0 },
      ]);
      expect(result.stats.daysLogged).toBe(1);
    });

    it('builds a missing rollup for a day whose only record is a water entry', async () => {
      const user = await makeUser();

      // +05:30 keeps this inside 2026-07-18 in IST.
      await createEntry(authed(user), {
        amountMl: 1250,
        loggedAt: new Date('2026-07-18T09:00:00.000Z'),
      });
      await DailySummaryModel.deleteMany({});

      const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

      // Water alone: 1250 / 2500 = 50.
      expect(result.days.map((d) => [d.localDate, d.percent])).toEqual([
        ['2026-07-18', 50],
      ]);
    });

    it('builds a day whose habit log is INCOMPLETE — no timeline event is emitted for one', async () => {
      const user = await makeUser();
      const habitId = await makeHabit(user.id, new Date('2026-07-01T00:00:00Z'));

      await logHabit(authed(user), habitId, {
        localDate: asLocalDate('2026-07-18'),
        count: 5, // target is 20
      });

      // The PersonalEvent scan alone would miss this day entirely.
      expect(await PersonalEventModel.countDocuments({})).toBe(0);

      const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

      expect(result.days).toEqual([
        { localDate: '2026-07-18', percent: 0, eventCount: 0 },
      ]);
    });

    it('does not build days the user logged nothing on', async () => {
      const user = await makeUser();
      const habitId = await makeHabit(user.id, new Date('2026-07-01T00:00:00Z'));

      await logHabit(authed(user), habitId, {
        localDate: asLocalDate('2026-07-18'),
        count: 20,
      });

      const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

      expect(result.days).toHaveLength(1);
      expect(await DailySummaryModel.countDocuments({})).toBe(1);
    });
  });

  it('omits a cached all-zero day — opening the app is not logging a zero', async () => {
    const user = await makeUser();
    // Exactly what buildDailySummary writes for a day the user never touched: the
    // Today route rebuilds the whole current week on every load, so these exist in
    // the cache for anybody who has opened the app this week.
    await seedDay(user.id, '2026-07-18', { scheduled: 0, completionRate: 0, eventCount: 0 });
    await seedDay(user.id, '2026-07-19', { scheduled: 2, completionRate: 0, eventCount: 0 });

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    // 07-18: nothing at all -> absent. 07-19: habits were scheduled and missed, which
    // is a zero the user earned -> present.
    expect(result.days.map((d) => d.localDate)).toEqual(['2026-07-19']);
    expect(result.stats.daysLogged).toBe(1);
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
