import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addLocalDays, asLocalDate, todayLocalDate } from '@synitheia/shared';
import {
  HabitLogModel,
  HabitModel,
  PersonalEventModel,
  UserModel,
  XpAwardModel,
} from '../../db/models.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { logHabit, scheduledOn } from './service.js';

let mongo: MongoMemoryReplSet;

const IST = 'Asia/Kolkata';

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    XpAwardModel.syncIndexes(),
    HabitLogModel.syncIndexes(),
    PersonalEventModel.syncIndexes(),
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
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

async function seedHabit(userId: string) {
  return HabitModel.create({
    userId: new Types.ObjectId(userId),
    name: 'Reading',
    icon: 'book-open',
    color: '#7D927D',
    frequency: 'daily',
    measure: 'check',
    targetCount: 1,
  });
}

const completions = (userId: string) =>
  PersonalEventModel.find({ userId: new Types.ObjectId(userId), type: 'habit.completed' })
    .sort({ localDate: 1 })
    .lean();

/**
 * Undo on a habit tick sends a step back. The timeline must agree with the tick: a habit
 * that is no longer done today cannot still read "Reading completed" on Today.
 */
describe('stepping a habit back below its target', () => {
  it('takes that day’s completion off the timeline', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id);

    await logHabit(user, habit.id, { increment: 1 });
    expect(await completions(user.id)).toHaveLength(1);

    await logHabit(user, habit.id, { increment: -1 });
    expect(await completions(user.id)).toHaveLength(0);
  });

  it('leaves other days’ completions alone', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id);
    const today = todayLocalDate(IST);
    const yesterday = addLocalDays(today, -1);

    await logHabit(user, habit.id, { increment: 1, localDate: yesterday });
    await logHabit(user, habit.id, { increment: 1 });
    await logHabit(user, habit.id, { increment: -1 });

    // The day a completion is for is in its key; its timestamp is when it was logged.
    const left = await completions(user.id);
    expect(left.map((event) => event.dedupeKey)).toEqual([
      `manual:habit:${habit.id}:${asLocalDate(yesterday)}`,
    ]);
  });

  it('puts the completion back when it is ticked again', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id);

    await logHabit(user, habit.id, { increment: 1 });
    await logHabit(user, habit.id, { increment: -1 });
    await logHabit(user, habit.id, { increment: 1 });

    expect(await completions(user.id)).toHaveLength(1);
  });
});

/**
 * A habit ticked for an earlier day, from the day screen or the history calendar, belongs on
 * that day's timeline. It was stamped with the moment of the tap, so it landed on today.
 */
describe('completing a habit for an earlier day', () => {
  it('puts the completion on that day, not on today', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id);
    const threeDaysAgo = addLocalDays(todayLocalDate(IST), -3);

    await logHabit(user, habit._id.toString(), { localDate: threeDaysAgo, count: 1 });

    const events = await completions(user.id);
    expect(events.map((e) => e.localDate)).toEqual([threeDaysAgo]);
  });

  it('keeps the real time for a habit completed today', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id);
    const before = Date.now();

    await logHabit(user, habit._id.toString(), { count: 1 });

    const [event] = await completions(user.id);
    expect(event!.localDate).toBe(todayLocalDate(IST));
    expect(new Date(event!.timestamp).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});

/**
 * A day's ring counts the habits that existed on it. A habit created today and ticked for
 * three days ago did exist, as far as that day's record goes: leaving it out showed the day
 * at 0% under a fully ticked list.
 */
describe('which habits count on an earlier day', () => {
  it('counts a habit created later when it was logged on that day', async () => {
    const user = await seedUser();
    const habit = await seedHabit(user.id);
    const threeDaysAgo = addLocalDays(todayLocalDate(IST), -3);

    await logHabit(user, habit._id.toString(), { localDate: threeDaysAgo, count: 1 });

    const ids = (await scheduledOn(user.id, threeDaysAgo)).map((h) => h._id.toString());
    expect(ids).toEqual([habit._id.toString()]);
  });

  it('still leaves out a habit that did not exist and was not logged that day', async () => {
    const user = await seedUser();
    await seedHabit(user.id);

    expect(await scheduledOn(user.id, addLocalDays(todayLocalDate(IST), -3))).toEqual([]);
  });
});
