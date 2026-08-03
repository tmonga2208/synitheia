import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { XP_AMOUNTS, todayLocalDate, type SyncHealthInput } from '@synitheia/shared';
import {
  DataSourceConnectionModel,
  HabitLogModel,
  HabitModel,
  HealthDayModel,
  UserModel,
  XpAwardModel,
} from '../../db/models.js';
import { sync } from './service.js';

/**
 * The fourth habit-completion path.
 *
 * `applyStepsToHabits` writes a HabitLog with `completedAt` set and recomputes the
 * streak — a genuine completion by every definition the rest of the app uses — but it
 * does not route through `logHabit`. A user whose habits are step-measured and who has
 * connected Health completes them every single day without touching the app, and the
 * spec's "Where awards fire" table simply missed the site. Without this, XP is silently
 * dead for that entire class of user, and no streak milestone is ever reachable.
 */

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
  await Promise.all([
    HabitModel.deleteMany({}),
    HabitLogModel.deleteMany({}),
    HealthDayModel.deleteMany({}),
    DataSourceConnectionModel.deleteMany({}),
    XpAwardModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

async function seedUser(): Promise<{ id: string; timezone: string }> {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test User',
    timezone: IST,
    currency: 'INR',
  });

  // Health is read only with a live consent record — see requireConsent.
  await DataSourceConnectionModel.create({
    userId: user._id,
    source: 'health',
    status: 'connected',
    connectedAt: new Date(),
  });

  return { id: user._id.toString(), timezone: IST };
}

async function seedStepHabit(userId: string, targetCount = 8000) {
  return HabitModel.create({
    userId: new Types.ObjectId(userId),
    name: 'Walk',
    icon: 'Footprints',
    color: '#7D927D',
    frequency: 'daily',
    measure: 'steps',
    targetCount,
    unit: 'steps',
  });
}

function syncInput(localDate: string, steps: number): SyncHealthInput {
  return {
    days: [
      {
        localDate,
        steps,
        activeEnergyKcal: null,
        exerciseMinutes: null,
        sleepMinutes: null,
        sleepStart: null,
        sleepEnd: null,
        restingHeartRate: null,
        workouts: [],
      },
    ],
  };
}

describe('applyStepsToHabits — XP wiring', () => {
  it('a step sync that completes a step habit grants the habit award', async () => {
    const user = await seedUser();
    const habit = await seedStepHabit(user.id);
    const today = todayLocalDate(IST);

    await sync(user, syncInput(today, 9000));

    const award = await XpAwardModel.findOne({
      userId: new Types.ObjectId(user.id),
      key: `habit:${habit._id.toString()}:${today}`,
    });
    expect(award?.amount).toBe(XP_AMOUNTS.habitComplete);

    // The only habit scheduled today is now complete, so the day bonus lands too —
    // the same rule a manual log gets, from the same shared award function.
    const stored = await UserModel.findById(user.id);
    expect(stored?.xp).toBe(XP_AMOUNTS.habitComplete + XP_AMOUNTS.dayComplete);
  });

  it('syncing the same day again grants nothing further', async () => {
    const user = await seedUser();
    await seedStepHabit(user.id);
    const today = todayLocalDate(IST);

    await sync(user, syncInput(today, 9000));
    const afterFirst = (await UserModel.findById(user.id))?.xp;

    // A re-sync is the normal case, not the exception: the phone pushes today's
    // cumulative step count every time the app opens.
    await sync(user, syncInput(today, 11_000));
    const afterSecond = (await UserModel.findById(user.id))?.xp;

    expect(afterFirst).toBe(XP_AMOUNTS.habitComplete + XP_AMOUNTS.dayComplete);
    expect(afterSecond).toBe(afterFirst);
    expect(
      await XpAwardModel.countDocuments({ userId: new Types.ObjectId(user.id) }),
    ).toBe(2);
  });

  it('a step sync below the target grants nothing', async () => {
    const user = await seedUser();
    await seedStepHabit(user.id, 8000);

    await sync(user, syncInput(todayLocalDate(IST), 3000));

    expect(
      await XpAwardModel.countDocuments({ userId: new Types.ObjectId(user.id) }),
    ).toBe(0);
    expect((await UserModel.findById(user.id))?.xp).toBe(0);
  });

  it('never fails the sync when granting XP throws', async () => {
    const user = await seedUser();
    await seedStepHabit(user.id);

    // Delete the user out from under the grant so grantAwards throws — the health
    // sync, which is the user's actual data landing, must still succeed.
    await UserModel.deleteOne({ _id: new Types.ObjectId(user.id) });

    await expect(sync(user, syncInput(todayLocalDate(IST), 9000))).resolves.toMatchObject({
      days: 1,
      stepsApplied: 1,
    });
  });
});
