import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { asLocalDate } from '@synitheia/shared';
import {
  HabitLogModel,
  HabitModel,
  InferredContextModel,
  PersonalEventModel,
  UserPreferenceModel,
} from '../../db/models.js';
import { dedupeKey, emit } from '../engine.js';
import { runDetectors } from './run.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    PersonalEventModel.syncIndexes(),
    InferredContextModel.syncIndexes(),
    UserPreferenceModel.syncIndexes(),
    HabitModel.syncIndexes(),
    HabitLogModel.syncIndexes(),
  ]);
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([
    PersonalEventModel.deleteMany({}),
    InferredContextModel.deleteMany({}),
    UserPreferenceModel.deleteMany({}),
    HabitModel.deleteMany({}),
    HabitLogModel.deleteMany({}),
  ]);
});

const IST = 'Asia/Kolkata';
const TODAY = asLocalDate('2026-07-12');

function freshUser() {
  return new Types.ObjectId().toString();
}

/** 13:04 IST on 2026-07-12 — inside the lunch window. */
function at(localTime: string, day = '2026-07-12'): Date {
  const [h, m] = localTime.split(':').map(Number) as [number, number];
  // IST is UTC+5:30, no DST, so this arithmetic is exact.
  const utcMinutes = h * 60 + m - (5 * 60 + 30);
  const base = Date.parse(`${day}T00:00:00Z`);
  return new Date(base + utcMinutes * 60_000);
}

async function foodExpense(userId: string, when: Date, amountMinor = 25000) {
  return emit({
    userId,
    source: 'manual',
    timestamp: when,
    timezone: IST,
    refId: new Types.ObjectId(),
    dedupeKey: dedupeKey('manual', 'expense', new Types.ObjectId().toString()),
    metadata: {
      type: 'expense.created',
      amountMinor,
      currency: 'INR',
      categoryName: 'Food',
      categoryColor: '#C08A7D',
      merchant: null,
      note: null,
    },
  });
}

describe('possible_meal detector', () => {
  it('suggests lunch from a food expense in the lunch window', async () => {
    const userId = freshUser();
    await foodExpense(userId, at('13:04'));

    expect(await runDetectors(userId, IST, TODAY)).toHaveLength(1);

    const suggestion = await InferredContextModel.findOne({ userId }).lean();
    expect(suggestion).toBeTruthy();
    expect(suggestion!.type).toBe('possible_meal');
    expect(suggestion!.status).toBe('pending');
    expect(suggestion!.title).toContain('lunch');
    expect((suggestion!.proposed as { mealType: string }).mealType).toBe('lunch');
  });

  it('never claims certainty — confidence stays below 1', async () => {
    const userId = freshUser();
    await foodExpense(userId, at('13:04'));
    await runDetectors(userId, IST, TODAY);

    const s = await InferredContextModel.findOne({ userId }).lean();
    expect(s!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(s!.confidence).toBeLessThan(1);
  });

  it('does not invent a calorie count it cannot know', async () => {
    // Guessing "600 kcal" and writing it into someone's nutrition log would be worse
    // than leaving the field for them to fill in.
    const userId = freshUser();
    await foodExpense(userId, at('13:04'));
    await runDetectors(userId, IST, TODAY);

    const s = await InferredContextModel.findOne({ userId }).lean();
    expect((s!.proposed as { estimatedCalories: number | null }).estimatedCalories).toBeNull();
  });

  it('raises confidence when the pattern recurs', async () => {
    const lone = freshUser();
    await foodExpense(lone, at('13:04'));
    await runDetectors(lone, IST, TODAY);
    const loneConfidence = (await InferredContextModel.findOne({ userId: lone }).lean())!
      .confidence;

    const habitual = freshUser();
    await foodExpense(habitual, at('13:04'));
    for (const day of ['2026-07-09', '2026-07-10', '2026-07-11']) {
      await foodExpense(habitual, at('13:10', day));
    }
    await runDetectors(habitual, IST, TODAY);
    const habitualConfidence = (
      await InferredContextModel.findOne({ userId: habitual }).lean()
    )!.confidence;

    expect(habitualConfidence).toBeGreaterThan(loneConfidence);
  });

  it('records legible evidence so "why am I seeing this?" can be answered', async () => {
    const userId = freshUser();
    await foodExpense(userId, at('13:04'));
    await runDetectors(userId, IST, TODAY);

    const s = await InferredContextModel.findOne({ userId }).lean();
    const evidence = s!.evidence as { label: string }[];

    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]!.label).toMatch(/Food expense at/);
    expect(s!.supportingEventIds.length).toBeGreaterThan(0);
  });

  it('stays silent when the user already logged food', async () => {
    const userId = freshUser();
    await foodExpense(userId, at('13:04'));

    await emit({
      userId,
      source: 'manual',
      timestamp: at('13:20'),
      timezone: IST,
      dedupeKey: dedupeKey('manual', 'food', 'f1'),
      metadata: {
        type: 'food.logged',
        foodName: 'Thali',
        mealType: 'lunch',
        calories: 600,
        proteinG: 20,
        carbsG: 80,
        fatG: 18,
      },
    });

    expect(await runDetectors(userId, IST, TODAY)).toHaveLength(0);
  });

  it('stays silent for a food expense outside any meal window', async () => {
    const userId = freshUser();
    await foodExpense(userId, at('16:30')); // mid-afternoon — not a meal window

    expect(await runDetectors(userId, IST, TODAY)).toHaveLength(0);
  });

  it('stays silent for a non-food expense', async () => {
    const userId = freshUser();
    await emit({
      userId,
      source: 'manual',
      timestamp: at('13:04'),
      timezone: IST,
      dedupeKey: dedupeKey('manual', 'expense', 'e1'),
      metadata: {
        type: 'expense.created',
        amountMinor: 25000,
        currency: 'INR',
        categoryName: 'Transport',
        categoryColor: '#7D8FA9',
        merchant: null,
        note: null,
      },
    });

    expect(await runDetectors(userId, IST, TODAY)).toHaveLength(0);
  });

  /**
   * The Today screen calls runDetectors on every load. Without the unique index on
   * (userId, detector, localDate), every pull-to-refresh would stack another identical
   * "did you have lunch?" card — turning the home screen into the cluttered nag-list
   * the product brief explicitly forbids.
   */
  it('asks the same question at most once per day', async () => {
    const userId = freshUser();
    await foodExpense(userId, at('13:04'));

    expect(await runDetectors(userId, IST, TODAY)).toHaveLength(1);
    expect(await runDetectors(userId, IST, TODAY)).toHaveLength(0);
    expect(await runDetectors(userId, IST, TODAY)).toHaveLength(0);

    expect(await InferredContextModel.countDocuments({ userId })).toBe(1);
  });

  it('never writes a domain record — only a question', async () => {
    // The whole contract: Detect → Infer → Suggest → Confirm. A detector that wrote a
    // FoodEntry directly would be "Detect → Silently Assume", which the brief forbids.
    const userId = freshUser();
    await foodExpense(userId, at('13:04'));
    await runDetectors(userId, IST, TODAY);

    const suggestion = await InferredContextModel.findOne({ userId }).lean();
    expect(suggestion!.status).toBe('pending');
    expect(suggestion!.resolvedAt).toBeNull();

    // No food event was emitted — nothing entered the user's actual log.
    const foodEvents = await PersonalEventModel.countDocuments({
      userId,
      type: 'food.logged',
    });
    expect(foodEvents).toBe(0);
  });

  it('returns what it created, and nothing on a second run', async () => {
    const userId = freshUser();
    await foodExpense(userId, at('13:04'));

    const first = await runDetectors(userId, IST, TODAY);
    expect(first).toEqual([
      expect.objectContaining({ type: 'possible_meal', actionable: true }),
    ]);
    expect(first[0]!.id).toMatch(/^[a-f\d]{24}$/);

    expect(await runDetectors(userId, IST, TODAY)).toEqual([]);
  });
});

describe('low_water detector', () => {
  async function water(userId: string, day: string, totalMl: number) {
    return emit({
      userId,
      source: 'manual',
      timestamp: at('20:00', day),
      timezone: IST,
      dedupeKey: dedupeKey('manual', 'water', `${day}-total`),
      metadata: {
        type: 'water.logged',
        amountMl: 250,
        totalMlToday: totalMl,
        targetMl: 2500,
      },
    });
  }

  it('fires in the evening when intake is far below the user\'s own baseline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('21:00')); // evening in IST

    const userId = freshUser();
    await UserPreferenceModel.create({ userId: new Types.ObjectId(userId), waterTargetMl: 2500 });

    for (const day of ['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11']) {
      await water(userId, day, 2000);
    }
    await water(userId, '2026-07-12', 400); // today: far below the ~2000ml baseline

    await runDetectors(userId, IST, TODAY);

    const s = await InferredContextModel.findOne({ userId, type: 'low_water' }).lean();
    expect(s).toBeTruthy();
    // Compared against the user's OWN average, not a "drink 8 glasses" slogan.
    expect(s!.description).toContain('2000');
  });

  it('does not fire in the morning, when everyone is legitimately "behind"', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('09:00'));

    const userId = freshUser();
    for (const day of ['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11']) {
      await water(userId, day, 2000);
    }
    await water(userId, '2026-07-12', 200);

    await runDetectors(userId, IST, TODAY);

    expect(
      await InferredContextModel.countDocuments({ userId, type: 'low_water' }),
    ).toBe(0);
  });

  it('does not fire without enough history to have a baseline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('21:00'));

    // A brand-new user has no "usual". Telling them they're below a baseline we
    // invented would be exactly the generic nagging the brief rules out.
    const userId = freshUser();
    await water(userId, '2026-07-12', 100);

    await runDetectors(userId, IST, TODAY);

    expect(
      await InferredContextModel.countDocuments({ userId, type: 'low_water' }),
    ).toBe(0);
  });

  it('does not fire when the user is tracking close to their normal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('21:00'));

    const userId = freshUser();
    for (const day of ['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11']) {
      await water(userId, day, 2000);
    }
    await water(userId, '2026-07-12', 1800); // 90% of baseline — fine

    await runDetectors(userId, IST, TODAY);

    expect(
      await InferredContextModel.countDocuments({ userId, type: 'low_water' }),
    ).toBe(0);
  });
});

describe('workout → habit, through the runner', () => {
  async function runHabit(userId: string) {
    return HabitModel.create({
      userId: new Types.ObjectId(userId),
      name: 'Morning run',
      icon: 'activity',
      color: '#7D927D',
      frequency: 'daily',
      measure: 'check',
      targetCount: 1,
      // Before TODAY: `scheduledOn` rightly ignores a habit that did not exist yet on the
      // day being evaluated, and the wall clock is months past this file's fixture dates.
      createdAt: at('08:00', '2026-07-01'),
    });
  }

  async function workout(userId: string) {
    return emit({
      userId,
      source: 'health',
      timestamp: at('12:00'),
      timezone: IST,
      dedupeKey: dedupeKey('health', 'workout', `${TODAY}:0`),
      metadata: { type: 'workout.detected', activity: 'running', durationMin: 32, calories: 300 },
    });
  }

  it('creates one actionable suggestion for the matching habit', async () => {
    const userId = freshUser();
    const habit = await runHabit(userId);
    await workout(userId);

    const created = await runDetectors(userId, IST, TODAY, { now: at('13:00') });

    expect(created).toEqual([
      expect.objectContaining({
        type: 'possible_habit_completion',
        title: 'Mark Morning run done?',
        actionable: true,
      }),
    ]);
    const stored = await InferredContextModel.findOne({ userId }).lean();
    expect(stored!.proposed).toEqual({ kind: 'habit', habitId: habit._id.toString(), count: 1 });
  });

  it('stays silent on later days once the user has rejected it for that habit', async () => {
    const userId = freshUser();
    const habit = await runHabit(userId);

    // Yesterday's suggestion, rejected.
    await InferredContextModel.create({
      userId: new Types.ObjectId(userId),
      type: 'possible_habit_completion',
      confidence: 0.8,
      detector: `workout_habit:${habit._id.toString()}`,
      title: 'Mark Morning run done?',
      proposed: { kind: 'habit', habitId: habit._id.toString(), count: 1 },
      status: 'rejected',
      localDate: '2026-07-11',
      expiresAt: at('12:00'),
      resolvedAt: at('12:00', '2026-07-11'),
    });

    await workout(userId);

    expect(await runDetectors(userId, IST, TODAY, { now: at('13:00') })).toEqual([]);
  });
});
