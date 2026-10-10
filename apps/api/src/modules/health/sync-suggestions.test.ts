import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { todayLocalDate, type SyncHealthInput } from '@synitheia/shared';
import {
  DataSourceConnectionModel,
  HabitLogModel,
  HabitModel,
  InferredContextModel,
  PersonalEventModel,
  UserPreferenceModel,
} from '../../db/models.js';
import * as calendar from '../calendar/service.js';
import * as health from './service.js';

let mongo: MongoMemoryReplSet;
const IST = 'Asia/Kolkata';

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    PersonalEventModel.syncIndexes(),
    InferredContextModel.syncIndexes(),
    HabitModel.syncIndexes(),
    HabitLogModel.syncIndexes(),
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all([
    PersonalEventModel.deleteMany({}),
    InferredContextModel.deleteMany({}),
    HabitModel.deleteMany({}),
    HabitLogModel.deleteMany({}),
    DataSourceConnectionModel.deleteMany({}),
    UserPreferenceModel.deleteMany({}),
  ]);
});

async function connectedUser(source: 'health' | 'calendar') {
  const user = { id: new Types.ObjectId().toString(), timezone: IST, currency: 'INR' };
  await DataSourceConnectionModel.create({
    userId: new Types.ObjectId(user.id),
    source,
    status: 'connected',
  });
  return user;
}

function dayWithRun(): SyncHealthInput {
  return {
    days: [
      {
        localDate: todayLocalDate(IST),
        steps: null,
        activeEnergyKcal: null,
        exerciseMinutes: null,
        sleepMinutes: null,
        sleepStart: null,
        sleepEnd: null,
        restingHeartRate: null,
        workouts: [{ kind: 'running', minutes: 32, energyKcal: 300 }],
      },
    ],
  };
}

describe('health sync → suggestions', () => {
  it('returns the suggestion a synced workout creates', async () => {
    const user = await connectedUser('health');
    await HabitModel.create({
      userId: new Types.ObjectId(user.id),
      name: 'Morning run',
      icon: 'activity',
      color: '#7D927D',
      frequency: 'daily',
      measure: 'check',
      targetCount: 1,
    });

    const result = await health.sync(user, dayWithRun());

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        type: 'possible_habit_completion',
        title: 'Mark Morning run done?',
        actionable: true,
      }),
    ]);
  });

  it('returns nothing the second time the same data is synced', async () => {
    const user = await connectedUser('health');
    await HabitModel.create({
      userId: new Types.ObjectId(user.id),
      name: 'Morning run',
      icon: 'activity',
      color: '#7D927D',
      frequency: 'daily',
      measure: 'check',
      targetCount: 1,
    });

    await health.sync(user, dayWithRun());
    const second = await health.sync(user, dayWithRun());

    expect(second.suggestions).toEqual([]);
    expect(await InferredContextModel.countDocuments({})).toBe(1);
  });

  it('returns an empty list, not an error, when nothing is worth suggesting', async () => {
    const user = await connectedUser('health');
    const result = await health.sync(user, dayWithRun());
    expect(result.suggestions).toEqual([]);
    expect(result.days).toBe(1);
  });
});

describe('calendar sync → suggestions', () => {
  it('carries a suggestions list on its response', async () => {
    const user = await connectedUser('calendar');
    const result = await calendar.sync(user, { events: [] });
    expect(result).toEqual({ events: 0, added: 0, suggestions: [] });
  });
});
