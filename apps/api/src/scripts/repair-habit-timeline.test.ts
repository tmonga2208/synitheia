import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DailySummaryModel, PersonalEventModel } from '../db/models.js';
import { repairHabitTimeline } from './repair-habit-timeline.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
});

const userId = new Types.ObjectId();
const habitId = new Types.ObjectId().toString();

/** A habit.completed entry as the old route filed it: keyed for `forDay`, dated `filedOn`. */
async function completion(forDay: string, filedOn: string) {
  return PersonalEventModel.collection.insertOne({
    userId,
    type: 'habit.completed',
    source: 'manual',
    timestamp: new Date(`${filedOn}T07:31:00.000Z`),
    localDate: filedOn,
    timezone: 'Asia/Kolkata',
    confidence: 1,
    dedupeKey: `manual:habit:${habitId}:${forDay}`,
    metadata: { type: 'habit.completed', habitId, habitName: 'Read' },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('repairHabitTimeline', () => {
  it('reports what it would move and changes nothing without --apply', async () => {
    await completion('2026-10-25', '2026-10-29');
    await completion('2026-10-29', '2026-10-29');

    const report = await repairHabitTimeline(false);

    expect(report).toMatchObject({ applied: false, misfiled: 1, users: 1 });
    expect(report.examples).toEqual([{ from: '2026-10-29', to: '2026-10-25' }]);
    const dates = (await PersonalEventModel.find().lean()).map((e) => e.localDate).sort();
    expect(dates).toEqual(['2026-10-29', '2026-10-29']);
  });

  it('moves a misfiled completion to midday of its own day and drops both days’ summaries', async () => {
    await completion('2026-10-25', '2026-10-29');
    await DailySummaryModel.collection.insertMany([
      { userId, localDate: '2026-10-25' },
      { userId, localDate: '2026-10-29' },
      { userId, localDate: '2026-10-20' },
    ]);

    const report = await repairHabitTimeline(true);

    expect(report.misfiled).toBe(1);
    const [event] = await PersonalEventModel.find().lean();
    expect(event!.localDate).toBe('2026-10-25');
    // Midday in India is 06:30 UTC.
    expect(new Date(event!.timestamp).toISOString()).toBe('2026-10-25T06:30:00.000Z');
    const left = (await DailySummaryModel.find().lean()).map((s) => s.localDate);
    expect(left).toEqual(['2026-10-20']);
  });

  it('leaves correctly filed completions alone, so a second run moves nothing', async () => {
    await completion('2026-10-25', '2026-10-29');
    await repairHabitTimeline(true);

    expect((await repairHabitTimeline(true)).misfiled).toBe(0);
  });
});
