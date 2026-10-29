import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addLocalDays, todayLocalDate, type LocalDate } from '@synitheia/shared';
import {
  DataSourceConnectionModel,
  UserModel,
  UserPreferenceModel,
  WeightEntryModel,
} from '../../db/models.js';
import { bodyReport, logWeight, setCalorieGoal, sync } from './service.js';

let mongo: MongoMemoryReplSet;
const IST = 'Asia/Kolkata';

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await WeightEntryModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
});

/** 30, 175 cm, male, 80 kg: everything the calorie maths needs. */
async function seedUser() {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Weigher',
    timezone: IST,
    currency: 'INR',
  });
  await UserPreferenceModel.create({
    userId: user._id,
    bodyMetrics: { heightCm: 175, weightKg: 80, biologicalSex: 'male', birthDate: '1996-01-01' },
  });
  await DataSourceConnectionModel.create({
    userId: user._id,
    source: 'health',
    status: 'connected',
    connectedAt: new Date(),
  });
  return { id: user._id.toString(), timezone: IST };
}

const today = () => todayLocalDate(IST);
const healthSync = (weightKg: number) => ({ days: [], body: { weightKg } });

describe('weight check-ins', () => {
  it('move a chosen goal’s target with the weight, by what the weight changes', async () => {
    const user = await seedUser();
    const chosen = await setCalorieGoal(user, 'lose');

    const after = await logWeight(user, { weightKg: 78 });

    expect(after.body.weightKg).toBe(78);
    // Resting burn falls 20 kcal with 2 kg; maintenance scales by the same ratio.
    expect(after.currentCalorieTarget).toBeLessThan(chosen.currentCalorieTarget);
    expect(chosen.currentCalorieTarget - after.currentCalorieTarget).toBeLessThan(40);
  });

  it('leave the target alone when no goal was picked', async () => {
    const user = await seedUser();
    await UserPreferenceModel.updateOne({}, { $set: { calorieTarget: 2000 } });

    const after = await logWeight(user, { weightKg: 78 });

    expect(after.currentCalorieTarget).toBe(2000);
  });

  it('build a trend and a pace once there is a week to compare', async () => {
    const user = await seedUser();
    await setCalorieGoal(user, 'lose');
    await logWeight(user, { weightKg: 80, localDate: addLocalDays(today(), -7) as LocalDate });
    await logWeight(user, { weightKg: 79.5 });

    const report = await bodyReport(user);

    expect(report.weight.entries.map((e) => e.weightKg)).toEqual([80, 79.5]);
    expect(report.weight.weeklyChangeKg).toBe(-0.5);
    expect(report.weight.pace).toBe('on_track');
  });

  it('keep one entry a day, and do not turn Health’s repeated sample into a flat week', async () => {
    const user = await seedUser();
    await sync(user, healthSync(79));
    await sync(user, healthSync(79));

    expect(await WeightEntryModel.countDocuments()).toBe(1);
  });

  it('let a typed weight outrank Health’s for the same day', async () => {
    const user = await seedUser();
    await logWeight(user, { weightKg: 78.4 });
    await sync(user, healthSync(79.1));

    const report = await bodyReport(user);
    expect(report.body.weightKg).toBe(78.4);
    expect(report.weight.entries).toHaveLength(1);
  });

  it('put an earlier day on the trend without replacing today’s weight', async () => {
    const user = await seedUser();
    await logWeight(user, { weightKg: 78 });
    await logWeight(user, { weightKg: 81, localDate: addLocalDays(today(), -10) as LocalDate });

    const report = await bodyReport(user);
    expect(report.body.weightKg).toBe(78);
    expect(report.weight.entries).toHaveLength(2);
  });
});
