import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { asLocalDate } from '@synitheia/shared';
import {
  DailySummaryModel,
  DataSourceConnectionModel,
  ExpenseCategoryModel,
  HabitModel,
  PersonalEventModel,
} from '../db/models.js';
import type { AuthedUser } from '../core/auth-guard.js';
import { logHabit } from '../modules/habits/service.js';
import { createEntry, deleteEntry } from '../modules/water/routes.js';
import { rebuildDaily } from '../modules/nutrition/service.js';
import { createExpense, updateExpense } from '../modules/expenses/service.js';
import { sync } from '../modules/health/service.js';
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
  await HabitModel.deleteMany({});
  await DataSourceConnectionModel.deleteMany({});
  await ExpenseCategoryModel.deleteMany({});
  await PersonalEventModel.deleteMany({});
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

/**
 * Call-site wiring.
 *
 * The tests above prove the helper works in isolation; these prove it is actually
 * reached from the real writes — logging a habit, logging water, rebuilding a day's
 * nutrition, and moving an expense between days. Each seeds a summary, performs the
 * real write (not a call to invalidateDailySummary directly), and asserts the
 * document is gone, so a future refactor that drops one of these calls fails here.
 */
describe('call-site wiring', () => {
  function authedUser(id: string): AuthedUser {
    return { id, timezone: 'Asia/Kolkata', currency: 'INR' };
  }

  it('logHabit drops that day summary', async () => {
    const userId = new Types.ObjectId().toString();
    const user = authedUser(userId);

    const habit = await HabitModel.create({
      userId: new Types.ObjectId(userId),
      name: 'Push-ups',
      icon: 'dumbbell',
      color: '#7D927D',
      frequency: 'daily',
      measure: 'count',
      targetCount: 20,
    });

    await seedSummary(userId, DAY);

    await logHabit(user, habit._id.toString(), { localDate: DAY, count: 20 });

    expect(
      await DailySummaryModel.countDocuments({
        userId: new Types.ObjectId(userId),
        localDate: DAY,
      }),
    ).toBe(0);
  });

  it('water create drops that day summary', async () => {
    const userId = new Types.ObjectId().toString();
    const user = authedUser(userId);

    await seedSummary(userId, DAY);

    // +05:30 keeps this well inside DAY's local calendar date for the whole test.
    await createEntry(user, { amountMl: 250, loggedAt: new Date(`${DAY}T09:00:00.000Z`) });

    expect(
      await DailySummaryModel.countDocuments({
        userId: new Types.ObjectId(userId),
        localDate: DAY,
      }),
    ).toBe(0);
  });

  it('water delete drops the deleted entry day, 404s on a missing id, and retracts the timeline event', async () => {
    const userId = new Types.ObjectId().toString();
    const user = authedUser(userId);

    const { entry } = await createEntry(user, {
      amountMl: 250,
      loggedAt: new Date(`${DAY}T09:00:00.000Z`),
    });

    // Sanity: creating the entry really did emit a timeline event referencing it —
    // otherwise "retraction happened" below would be true vacuously.
    expect(await PersonalEventModel.countDocuments({ refId: entry._id })).toBe(1);

    await seedSummary(userId, DAY);

    await deleteEntry(user, entry._id.toString());

    expect(
      await DailySummaryModel.countDocuments({
        userId: new Types.ObjectId(userId),
        localDate: DAY,
      }),
    ).toBe(0);
    expect(await PersonalEventModel.countDocuments({ refId: entry._id })).toBe(0);

    await expect(deleteEntry(user, entry._id.toString())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rebuildDaily drops that day summary', async () => {
    const userId = new Types.ObjectId().toString();

    await seedSummary(userId, DAY);

    await rebuildDaily(userId, DAY);

    expect(
      await DailySummaryModel.countDocuments({
        userId: new Types.ObjectId(userId),
        localDate: DAY,
      }),
    ).toBe(0);
  });

  it('updateExpense moving an expense to a new day drops BOTH the old and new day summaries', async () => {
    const userId = new Types.ObjectId().toString();
    const user = authedUser(userId);

    const category = await ExpenseCategoryModel.create({
      userId: new Types.ObjectId(userId),
      name: 'Food',
      icon: 'fork',
      color: '#7D927D',
      isSystem: false,
    });

    const expense = await createExpense(user, {
      amountMinor: 10_000,
      categoryId: category._id.toString(),
      occurredAt: new Date(`${DAY}T09:00:00.000Z`),
    });

    // Seeded AFTER createExpense, which already invalidates DAY itself — otherwise
    // this would be asserting against a summary createExpense had already dropped.
    await seedSummary(userId, DAY);
    await seedSummary(userId, OTHER_DAY);

    await updateExpense(user, expense._id.toString(), {
      occurredAt: new Date(`${OTHER_DAY}T09:00:00.000Z`),
    });

    expect(
      await DailySummaryModel.countDocuments({
        userId: new Types.ObjectId(userId),
        localDate: DAY,
      }),
    ).toBe(0);
    expect(
      await DailySummaryModel.countDocuments({
        userId: new Types.ObjectId(userId),
        localDate: OTHER_DAY,
      }),
    ).toBe(0);
  });

  it('a Health steps sync drops the day it touched', async () => {
    const userId = new Types.ObjectId().toString();
    const user = authedUser(userId);

    await DataSourceConnectionModel.create({
      userId: new Types.ObjectId(userId),
      source: 'health',
      status: 'connected',
    });

    await HabitModel.create({
      userId: new Types.ObjectId(userId),
      name: 'Walk',
      icon: 'shoe',
      color: '#7D927D',
      frequency: 'daily',
      measure: 'steps',
      targetCount: 5000,
    });

    await seedSummary(userId, DAY);

    await sync(user, {
      days: [
        {
          localDate: DAY,
          steps: 6000,
          activeEnergyKcal: null,
          exerciseMinutes: null,
          sleepMinutes: null,
          sleepStart: null,
          sleepEnd: null,
          restingHeartRate: null,
          workouts: [],
        },
      ],
    });

    expect(
      await DailySummaryModel.countDocuments({
        userId: new Types.ObjectId(userId),
        localDate: DAY,
      }),
    ).toBe(0);
  });
});
