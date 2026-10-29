import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HabitLogModel, HabitModel, PersonalEventModel, UserModel, XpAwardModel } from '../../db/models.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { logHabit } from './service.js';

let mongo: MongoMemoryReplSet;
const IST = 'Asia/Kolkata';

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([XpAwardModel.syncIndexes(), HabitLogModel.syncIndexes(), PersonalEventModel.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});

async function setup(): Promise<{ user: AuthedUser; habitId: string }> {
  const u = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Reader',
    timezone: IST,
    currency: 'INR',
  });
  const habit = await HabitModel.create({
    userId: u._id,
    name: 'Reading',
    icon: 'book-open',
    color: '#7D927D',
    frequency: 'daily',
    measure: 'duration',
    unit: 'min',
    targetCount: 60,
  });
  return { user: { id: u._id.toString(), timezone: IST, currency: 'INR' }, habitId: habit._id.toString() };
}

describe('logHabit under quick taps', () => {
  it('counts every increment that arrives at once', async () => {
    const { user, habitId } = await setup();

    await Promise.all(Array.from({ length: 8 }, () => logHabit(user, habitId, { increment: 5 })));

    const log = await HabitLogModel.findOne({ habitId: new Types.ObjectId(habitId) }).lean();
    expect(log!.count).toBe(40);
  });

  it('never steps below zero', async () => {
    const { user, habitId } = await setup();
    await logHabit(user, habitId, { increment: 5 });

    await logHabit(user, habitId, { increment: -10 });

    const log = await HabitLogModel.findOne({ habitId: new Types.ObjectId(habitId) }).lean();
    expect(log!.count).toBe(0);
  });
});
