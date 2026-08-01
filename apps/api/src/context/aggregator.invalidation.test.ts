import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { asLocalDate } from '@synitheia/shared';
import { DailySummaryModel } from '../db/models.js';
import { invalidateDailySummary } from './aggregator.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await DailySummaryModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await DailySummaryModel.deleteMany({});
});

const DAY = asLocalDate('2026-07-18');
const OTHER_DAY = asLocalDate('2026-07-19');

async function seedSummary(userId: string, localDate: string) {
  await DailySummaryModel.create({
    userId: new Types.ObjectId(userId),
    localDate,
    expenses: { totalMinor: 0, count: 0, byCategory: {}, largestMinor: null },
    habits: { scheduled: 0, completed: 0, completionRate: 0, completedIds: [], missedIds: [] },
    nutrition: {
      totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      entryCount: 0,
      calorieTarget: 2000,
    },
    water: { totalMl: 0, targetMl: 2500, entryCount: 0 },
    activity: { steps: null, workoutMinutes: null, sleepMinutes: null },
    context: {
      weekday: 5,
      calendarEventCount: 0,
      lastCalendarEventEndMin: null,
      weatherCondition: null,
    },
    eventCount: 0,
    sources: [],
    generatedAt: new Date(),
  });
}

describe('invalidateDailySummary', () => {
  it('drops the cached summary for that user and day', async () => {
    const userId = new Types.ObjectId().toString();
    await seedSummary(userId, DAY);

    await invalidateDailySummary(userId, DAY);

    expect(await DailySummaryModel.countDocuments({ localDate: DAY })).toBe(0);
  });

  it('leaves other days alone', async () => {
    const userId = new Types.ObjectId().toString();
    await seedSummary(userId, DAY);
    await seedSummary(userId, OTHER_DAY);

    await invalidateDailySummary(userId, DAY);

    expect(await DailySummaryModel.countDocuments({ localDate: OTHER_DAY })).toBe(1);
  });

  it('leaves other users alone', async () => {
    const mine = new Types.ObjectId().toString();
    const theirs = new Types.ObjectId().toString();
    await seedSummary(mine, DAY);
    await seedSummary(theirs, DAY);

    await invalidateDailySummary(mine, DAY);

    expect(
      await DailySummaryModel.countDocuments({ userId: new Types.ObjectId(theirs) }),
    ).toBe(1);
  });

  it('is a no-op when there is nothing cached', async () => {
    await expect(
      invalidateDailySummary(new Types.ObjectId().toString(), DAY),
    ).resolves.toBeUndefined();
  });
});
