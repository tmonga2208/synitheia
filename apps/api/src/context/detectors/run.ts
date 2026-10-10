import { Types } from 'mongoose';
import {
  addLocalDays,
  measureOf,
  todayLocalDate,
  type LocalDate,
  type SyncSuggestion,
} from '@synitheia/shared';
import {
  HabitLogModel,
  InferredContextModel,
  PersonalEventModel,
  UserPreferenceModel,
} from '../../db/models.js';
import { scheduledOn } from '../../modules/habits/service.js';
import { detectLowWater } from './lowWater.js';
import { detectPossibleMeal } from './possibleMeal.js';
import type { Detector, DetectorContext, EventLean, HabitToday } from './types.js';

/**
 * Detectors — the "Detect → Infer" half of the loop.
 *
 * Every rule here is DETERMINISTIC. No LLM is involved, and that is a deliberate
 * safety boundary, not a cost decision: a hallucinated meal written into someone's
 * calorie log, or a hallucinated ₹400 into their expenses, is a real harm, and a model
 * that is right 95% of the time will do it roughly once a fortnight. Rules are auditable,
 * explainable, and wrong in ways we can actually fix.
 *
 * A detector NEVER writes a domain record. It writes an InferredContext — a question.
 * Only the user's confirmation (see modules/inference/routes.ts) creates real data.
 */

/** Eight weeks, so a same-weekday baseline has up to eight samples. */
const HISTORY_DAYS = 56;

export const DETECTORS: Detector[] = [detectPossibleMeal, detectLowWater];

export interface RunOptions {
  /** Injected so tests and backfills do not depend on the wall clock. */
  now?: Date;
  /** The user's home currency. Without it, currency-dependent rules stay silent. */
  currency?: string | null;
}

/**
 * Run every detector for a user's day and persist any new suggestions.
 *
 * Returns only what THIS call created. The (userId, detector, localDate) unique index
 * means a detector asks a given question at most once per day; a second run finds the
 * row already there and reports nothing, which is what lets a caller notify on the
 * return value without tracking what it has already shown.
 */
export async function runDetectors(
  userId: string,
  timezone: string,
  localDate: LocalDate = todayLocalDate(timezone),
  options: RunOptions = {},
): Promise<SyncSuggestion[]> {
  const uid = new Types.ObjectId(userId);

  const [events, history, prefs, scheduled, logs, rejected] = await Promise.all([
    PersonalEventModel.find({ userId: uid, localDate }).lean<EventLean[]>(),
    PersonalEventModel.find({
      userId: uid,
      // Anchored on the day being evaluated, not the wall clock: a run for a past
      // localDate must see the weeks before THAT day, or its history is empty.
      localDate: { $gte: addLocalDays(localDate, -HISTORY_DAYS), $lt: localDate },
    }).lean<EventLean[]>(),
    UserPreferenceModel.findOne({ userId: uid }).lean(),
    scheduledOn(userId, localDate),
    HabitLogModel.find({ userId: uid, localDate }, { habitId: 1, count: 1 }).lean(),
    InferredContextModel.find(
      { userId: uid, type: 'possible_habit_completion', status: 'rejected' },
      { proposed: 1 },
    ).lean(),
  ]);

  const countByHabit = new Map(logs.map((l) => [l.habitId.toString(), l.count]));

  const habits: HabitToday[] = scheduled
    .filter((h) => !h.archivedAt)
    .map((h) => ({
      id: h._id.toString(),
      name: h.name,
      measure: measureOf(h as { measure?: HabitToday['measure'] | null }),
      frequency: h.frequency as HabitToday['frequency'],
      targetCount: h.targetCount,
      reminderTime: h.reminderTime ?? null,
      countToday: countByHabit.get(h._id.toString()) ?? 0,
    }));

  const rejectedHabitIds = new Set(
    rejected
      .map((r) => (r.proposed as { habitId?: unknown }).habitId)
      .filter((id): id is string => typeof id === 'string'),
  );

  const ctx: DetectorContext = {
    userId,
    timezone,
    localDate,
    now: options.now ?? new Date(),
    currency: options.currency ?? null,
    events,
    history,
    habits,
    rejectedHabitIds,
    waterTargetMl: prefs?.waterTargetMl ?? 2500,
  };

  const detections = DETECTORS.flatMap((detect) => detect(ctx));
  const created: SyncSuggestion[] = [];

  for (const d of detections) {
    const result = await InferredContextModel.updateOne(
      { userId: uid, detector: d.detector, localDate },
      {
        $setOnInsert: {
          userId: uid,
          detector: d.detector,
          localDate,
          type: d.type,
          confidence: d.confidence,
          title: d.title,
          description: d.description,
          evidence: d.evidence,
          supportingEventIds: d.supportingEventIds,
          proposed: d.proposed,
          status: 'pending',
          // Stale suggestions are noise. A "did you have lunch?" card from four days
          // ago is not a question anyone wants to answer.
          expiresAt: new Date(ctx.now.getTime() + 48 * 60 * 60 * 1000),
          resolvedAt: null,
          correction: null,
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0 && result.upsertedId) {
      created.push({
        id: result.upsertedId.toString(),
        type: d.type,
        title: d.title,
        actionable: d.proposed.kind !== 'observation',
      });
    }
  }

  return created;
}
