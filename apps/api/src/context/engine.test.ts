import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { toLocalDate } from '@synitheia/shared';
import { PersonalEventModel } from '../db/models.js';
import { dedupeKey, emit, emitMany, retractByRef, timelineFor } from './engine.js';

/**
 * These run against a real MongoDB, not a mock.
 *
 * The properties under test — dedupe, idempotency — are enforced by unique INDEXES.
 * A mocked model would happily accept a duplicate and report success, testing nothing
 * except that the mock works. The whole point is to prove the database rejects it.
 */

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await PersonalEventModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await PersonalEventModel.deleteMany({});
});

const userId = new Types.ObjectId().toString();
const IST = 'Asia/Kolkata';

function stepsEvent(steps: number, at: string, tz = IST) {
  return {
    userId,
    source: 'health' as const,
    timestamp: new Date(at),
    timezone: tz,
    dedupeKey: dedupeKey('health', 'steps', toLocalDate(new Date(at), tz)),
    confidence: 0.95,
    metadata: {
      type: 'steps.recorded' as const,
      steps,
      distanceM: null,
    },
  };
}

describe('dedupeKey', () => {
  it('is stable for the same logical event', () => {
    expect(dedupeKey('health', 'steps', '2026-07-12')).toBe('health:steps:2026-07-12');
    expect(dedupeKey('health', 'steps', '2026-07-12')).toBe(
      dedupeKey('health', 'steps', '2026-07-12'),
    );
  });

  it('separates different sources and kinds', () => {
    expect(dedupeKey('health', 'steps', 'x')).not.toBe(dedupeKey('manual', 'steps', 'x'));
    expect(dedupeKey('health', 'steps', 'x')).not.toBe(dedupeKey('health', 'sleep', 'x'));
  });
});

describe('emit', () => {
  it('creates an event and derives localDate from the user timezone', async () => {
    // 20:00 UTC is 01:30 IST the NEXT day. The event belongs to the user's tomorrow.
    const { event, created } = await emit(stepsEvent(4812, '2026-07-12T20:00:00Z'));

    expect(created).toBe(true);
    expect(event.localDate).toBe('2026-07-13');
    expect(event.type).toBe('steps.recorded');
    expect(event.confidence).toBe(0.95);
  });

  it('defaults confidence to 1 for user-asserted events', async () => {
    const { event } = await emit({
      userId,
      source: 'manual',
      timestamp: new Date('2026-07-12T08:00:00Z'),
      timezone: IST,
      dedupeKey: dedupeKey('manual', 'water', 'abc'),
      metadata: {
        type: 'water.logged',
        amountMl: 500,
        totalMlToday: 500,
        targetMl: 2500,
      },
    });

    expect(event.confidence).toBe(1);
  });

  /**
   * The scenario this exists for: HealthKit re-delivers a day's step count on every
   * background wake. Without dedupe the timeline fills with duplicate rows, the
   * aggregator double-counts, and the AI reports 40,000 steps to someone who walked
   * 4,000.
   */
  it('is idempotent — re-emitting the same logical event does not duplicate it', async () => {
    const first = await emit(stepsEvent(4812, '2026-07-12T10:00:00Z'));
    const second = await emit(stepsEvent(4812, '2026-07-12T10:00:00Z'));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.event._id.toString()).toBe(first.event._id.toString());

    expect(await PersonalEventModel.countDocuments({ userId })).toBe(1);
  });

  it('updates the existing row when a re-synced value has grown', async () => {
    // Steps accumulate through the day. The 9am sync says 2,000; the 6pm sync says
    // 8,000. That is ONE event whose value changed, not two events.
    await emit(stepsEvent(2000, '2026-07-12T09:00:00Z'));
    await emit(stepsEvent(8000, '2026-07-12T09:00:00Z'));

    const events = await PersonalEventModel.find({ userId }).lean();
    expect(events).toHaveLength(1);
    expect((events[0]!.metadata as { steps: number }).steps).toBe(8000);
  });

  it('keeps different days as separate events', async () => {
    await emit(stepsEvent(4812, '2026-07-12T10:00:00Z'));
    await emit(stepsEvent(6000, '2026-07-13T10:00:00Z'));

    expect(await PersonalEventModel.countDocuments({ userId })).toBe(2);
  });

  it('scopes dedupe per user — two users may share a dedupeKey', async () => {
    const other = new Types.ObjectId().toString();

    await emit(stepsEvent(4812, '2026-07-12T10:00:00Z'));
    await emit({ ...stepsEvent(9999, '2026-07-12T10:00:00Z'), userId: other });

    expect(await PersonalEventModel.countDocuments({ userId })).toBe(1);
    expect(await PersonalEventModel.countDocuments({ userId: other })).toBe(1);
  });

  it('survives concurrent emits of the same event without a duplicate-key crash', async () => {
    // Two background syncs firing at once is not hypothetical — it is Tuesday. The
    // unique index must arbitrate, and upsert must not throw.
    const results = await Promise.all([
      emit(stepsEvent(4812, '2026-07-12T10:00:00Z')),
      emit(stepsEvent(4812, '2026-07-12T10:00:00Z')),
      emit(stepsEvent(4812, '2026-07-12T10:00:00Z')),
    ]);

    expect(results).toHaveLength(3);
    expect(await PersonalEventModel.countDocuments({ userId })).toBe(1);
  });
});

describe('emitMany', () => {
  it('reports created vs updated counts', async () => {
    const batch = [
      stepsEvent(1000, '2026-07-10T10:00:00Z'),
      stepsEvent(2000, '2026-07-11T10:00:00Z'),
      stepsEvent(3000, '2026-07-12T10:00:00Z'),
    ];

    expect(await emitMany(batch)).toEqual({ created: 3, updated: 0 });

    // A full re-sync of the same window creates nothing new.
    expect(await emitMany(batch)).toEqual({ created: 0, updated: 3 });
    expect(await PersonalEventModel.countDocuments({ userId })).toBe(3);
  });

  it('handles an empty batch', async () => {
    expect(await emitMany([])).toEqual({ created: 0, updated: 0 });
  });
});

describe('retractByRef', () => {
  it('removes the timeline events belonging to a deleted domain record', async () => {
    const refId = new Types.ObjectId();

    await emit({
      userId,
      source: 'manual',
      timestamp: new Date('2026-07-12T08:00:00Z'),
      timezone: IST,
      refId,
      dedupeKey: dedupeKey('manual', 'expense', refId.toString()),
      metadata: {
        type: 'expense.created',
        amountMinor: 32000,
        currency: 'INR',
        categoryName: 'Food',
        categoryColor: '#C08A7D',
        merchant: null,
        note: null,
      },
    });

    expect(await PersonalEventModel.countDocuments({ userId })).toBe(1);

    // Deleting the expense must delete it from Today too — the timeline is a
    // projection, not an immutable ledger, and leaving it would visibly lie.
    expect(await retractByRef(userId, refId)).toBe(1);
    expect(await PersonalEventModel.countDocuments({ userId })).toBe(0);
  });

  it('is a no-op for an unknown ref', async () => {
    expect(await retractByRef(userId, new Types.ObjectId())).toBe(0);
  });
});

describe('timelineFor', () => {
  it('returns a day in chronological order', async () => {
    await emit(stepsEvent(1000, '2026-07-12T12:00:00Z')); // 17:30 IST
    await emit({
      userId,
      source: 'manual',
      timestamp: new Date('2026-07-12T02:30:00Z'), // 08:00 IST
      timezone: IST,
      dedupeKey: dedupeKey('manual', 'water', 'w1'),
      metadata: {
        type: 'water.logged',
        amountMl: 500,
        totalMlToday: 500,
        targetMl: 2500,
      },
    });

    const timeline = await timelineFor(userId, '2026-07-12');

    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.type).toBe('water.logged'); // 08:00 comes before 17:30
    expect(timeline[1]!.type).toBe('steps.recorded');
  });

  it('does not leak another day into the timeline', async () => {
    await emit(stepsEvent(1000, '2026-07-12T10:00:00Z'));
    await emit(stepsEvent(2000, '2026-07-13T10:00:00Z'));

    expect(await timelineFor(userId, '2026-07-12')).toHaveLength(1);
  });

  /**
   * The bug this catches: filtering the timeline on a UTC range instead of localDate.
   * An IST user logging water at 11pm is at 17:30 UTC the same day — but a user in
   * New York logging at 9pm is 02:00 UTC the NEXT day, and a UTC-range query would
   * file it under tomorrow and show them an empty evening.
   */
  it('files a late-evening US event on the correct local day', async () => {
    const NY = 'America/New_York';

    await emit({
      userId,
      source: 'manual',
      timestamp: new Date('2026-07-13T02:00:00Z'), // 22:00 on Jul 12 in New York
      timezone: NY,
      dedupeKey: dedupeKey('manual', 'water', 'ny1'),
      metadata: {
        type: 'water.logged',
        amountMl: 300,
        totalMlToday: 300,
        targetMl: 2500,
      },
    });

    expect(await timelineFor(userId, '2026-07-12')).toHaveLength(1);
    expect(await timelineFor(userId, '2026-07-13')).toHaveLength(0);
  });
});
