import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { todayLocalDate } from '@synitheia/shared';
import { HabitLogModel, HabitModel, PersonalEventModel, UserModel } from '../../db/models.js';
import { confirmHabitSuggestion } from './service.js';

let mongo: MongoMemoryReplSet;
const IST = 'Asia/Kolkata';
const TODAY = todayLocalDate(IST);

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    HabitModel.syncIndexes(),
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
    HabitModel.deleteMany({}),
    HabitLogModel.deleteMany({}),
    PersonalEventModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

async function setup(habit: { measure?: string; targetCount?: number } = {}) {
  // grantAwards needs a real User document, or it logs an error for XP it cannot apply.
  const userDoc = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test',
    timezone: IST,
    currency: 'INR',
  });
  const user = { id: userDoc._id.toString(), timezone: IST, currency: 'INR' };
  const doc = await HabitModel.create({
    userId: userDoc._id,
    name: 'Morning run',
    icon: 'activity',
    color: '#7D927D',
    frequency: 'daily',
    measure: habit.measure ?? 'check',
    targetCount: habit.targetCount ?? 1,
  });
  return { user, habitId: doc._id.toString() };
}

describe('confirmHabitSuggestion', () => {
  it('logs the habit, marked as inferred', async () => {
    const { user, habitId } = await setup();

    const result = await confirmHabitSuggestion(user, {
      localDate: TODAY,
      proposed: { habitId, count: 1 },
    });

    expect(result).toEqual({ logged: true });
    const log = await HabitLogModel.findOne({ habitId: new Types.ObjectId(habitId) }).lean();
    expect(log!.count).toBe(1);
    expect(log!.source).toBe('inferred');
    expect(log!.completedAt).toBeTruthy();
  });

  it('adds minutes to what a duration habit already has', async () => {
    const { user, habitId } = await setup({ measure: 'duration', targetCount: 60 });
    await HabitLogModel.create({
      userId: new Types.ObjectId(user.id),
      habitId: new Types.ObjectId(habitId),
      localDate: TODAY,
      count: 10,
      targetCount: 60,
    });

    await confirmHabitSuggestion(user, { localDate: TODAY, proposed: { habitId, count: 32 } });

    const log = await HabitLogModel.findOne({ habitId: new Types.ObjectId(habitId) }).lean();
    expect(log!.count).toBe(42);
  });

  it('does not log twice when the habit was completed in the meantime', async () => {
    const { user, habitId } = await setup();
    await HabitLogModel.create({
      userId: new Types.ObjectId(user.id),
      habitId: new Types.ObjectId(habitId),
      localDate: TODAY,
      count: 1,
      targetCount: 1,
      completedAt: new Date(),
    });

    const result = await confirmHabitSuggestion(user, {
      localDate: TODAY,
      proposed: { habitId, count: 1 },
    });

    expect(result).toEqual({ logged: false, reason: 'already_complete' });
    const log = await HabitLogModel.findOne({ habitId: new Types.ObjectId(habitId) }).lean();
    expect(log!.count).toBe(1);
    expect(log!.source).toBe('manual');
  });

  it('resolves quietly when the habit has been archived', async () => {
    const { user, habitId } = await setup();
    await HabitModel.updateOne({ _id: habitId }, { $set: { archivedAt: new Date() } });

    const result = await confirmHabitSuggestion(user, {
      localDate: TODAY,
      proposed: { habitId, count: 1 },
    });

    expect(result).toEqual({ logged: false, reason: 'habit_gone' });
    expect(await HabitLogModel.countDocuments({})).toBe(0);
  });

  it("cannot log another user's habit", async () => {
    const { habitId } = await setup();
    const { user: stranger } = await setup();

    const result = await confirmHabitSuggestion(stranger, {
      localDate: TODAY,
      proposed: { habitId, count: 1 },
    });

    expect(result).toEqual({ logged: false, reason: 'habit_gone' });
    expect(await HabitLogModel.countDocuments({})).toBe(0);
  });
});
