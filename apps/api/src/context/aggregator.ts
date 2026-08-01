import { Types } from 'mongoose';
import {
  completionRate,
  isHabitComplete,
  localWeekdayIndex,
  netMinor,
  ZERO_MACROS,
  type ConnectableSource,
  type LocalDate,
  type Macros,
  type Participant,
} from '@synitheia/shared';
import {
  DailyNutritionModel,
  DailySummaryModel,
  ExpenseModel,
  HabitLogModel,
  PersonalEventModel,
  UserPreferenceModel,
  WaterEntryModel,
  type DailySummaryDoc,
} from '../db/models.js';
import * as habits from '../modules/habits/service.js';

/**
 * The Daily Context Aggregator.
 *
 * This is the layer that makes "do not send the user's entire database to an LLM"
 * structurally true rather than merely intended. Everything downstream of here — the
 * AI context builder, the insight generator — reads DailySummary documents and never
 * touches a raw collection. Every number in a DailySummary is computed here, in
 * deterministic code.
 *
 * The model interprets. It does not calculate. That separation is enforced by the
 * fact that it has nothing to calculate *from*.
 */

export async function buildDailySummary(
  userId: string,
  localDate: LocalDate,
): Promise<DailySummaryDoc> {
  const uid = new Types.ObjectId(userId);

  const [prefs, expenses, habitLogs, scheduledHabits, nutrition, water, events] =
    await Promise.all([
      UserPreferenceModel.findOne({ userId: uid }).lean(),
      ExpenseModel.find(
        { userId: uid, localDate },
        { amountMinor: 1, categoryName: 1, participants: 1 },
      ).lean(),
      HabitLogModel.find({ userId: uid, localDate }).lean(),
      habits.scheduledOn(userId, localDate),
      DailyNutritionModel.findOne({ userId: uid, localDate }).lean(),
      WaterEntryModel.find({ userId: uid, localDate }, { amountMl: 1 }).lean(),
      PersonalEventModel.find({ userId: uid, localDate }).lean(),
    ]);

  // ── Expenses
  const byCategory: Record<string, number> = {};
  let largest = 0;
  let expenseTotal = 0;

  // NET, not gross — the same number the expense list and the Today screen show. A
  // ₹1,000 dinner three friends have repaid cost ₹250, and the AI reading this summary
  // must not conclude the user's Friday spending quadrupled.
  for (const e of expenses) {
    const net = netMinor({
      amountMinor: e.amountMinor,
      // Pre-split expenses have no participants key at all — Mongoose does not backfill
      // schema defaults on lean reads, so this is genuinely undefined, not [].
      participants: (e.participants as Participant[] | undefined) ?? [],
    });

    expenseTotal += net;
    byCategory[e.categoryName] = (byCategory[e.categoryName] ?? 0) + net;
    if (net > largest) largest = net;
  }

  // ── Habits
  const completedLogs = habitLogs.filter((l) => isHabitComplete(l));
  const completedIds = new Set(completedLogs.map((l) => l.habitId.toString()));
  const scheduledIds = scheduledHabits.map((h) => h._id.toString());

  // ── Nutrition
  const totals: Macros = nutrition?.totals ?? { ...ZERO_MACROS };

  // ── Water
  const totalMl = water.reduce((acc, w) => acc + w.amountMl, 0);

  // ── Passive context
  const stepEvents = events.filter((e) => e.type === 'steps.recorded');
  const workoutEvents = events.filter((e) => e.type === 'workout.detected');
  const sleepEvents = events.filter((e) => e.type === 'sleep.detected');
  const calendarEvents = events.filter((e) => e.type === 'calendar.started');
  const weatherEvent = events.find((e) => e.type === 'weather.observed');

  const meta = (e: (typeof events)[number]) => e.metadata as Record<string, number>;

  /**
   * Null, not zero, when a source is not connected.
   *
   * "You walked 0 steps today" and "we have no idea how much you walked" are entirely
   * different statements, and only one of them is true for a user who never granted
   * health access. Collapsing them to 0 would have the AI congratulating people for
   * rest days they did not take, and is exactly the kind of fabrication the whole
   * confidence architecture exists to prevent.
   */
  const steps =
    stepEvents.length > 0
      ? stepEvents.reduce((acc, e) => Math.max(acc, meta(e).steps ?? 0), 0)
      : null;

  const workoutMinutes =
    workoutEvents.length > 0
      ? workoutEvents.reduce((acc, e) => acc + (meta(e).durationMin ?? 0), 0)
      : null;

  const sleepMinutes =
    sleepEvents.length > 0
      ? sleepEvents.reduce((acc, e) => acc + (meta(e).durationMin ?? 0), 0)
      : null;

  /**
   * When the user's last meeting ended, in local minutes past midnight. This exists
   * to make "you tend to skip workouts on days with late meetings" answerable from a
   * deterministic number rather than from a model's impression of a calendar dump.
   */
  const lastCalendarEventEndMin =
    calendarEvents.length > 0
      ? Math.max(
          ...calendarEvents.map((e) => {
            const local = new Date(e.timestamp);
            const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
            return mins + (meta(e).durationMin ?? 0);
          }),
        )
      : null;

  const sources = [
    ...new Set(
      events
        .map((e) => e.source)
        .filter((s): s is ConnectableSource =>
          ['health', 'calendar', 'location', 'weather'].includes(s),
        ),
    ),
  ];

  const summary = {
    userId: uid,
    localDate,
    expenses: {
      totalMinor: expenseTotal,
      count: expenses.length,
      byCategory,
      largestMinor: expenses.length > 0 ? largest : null,
    },
    habits: {
      scheduled: scheduledHabits.length,
      completed: completedLogs.length,
      completionRate: completionRate(completedLogs.length, scheduledHabits.length),
      completedIds: [...completedIds].map((id) => new Types.ObjectId(id)),
      missedIds: scheduledIds
        .filter((id) => !completedIds.has(id))
        .map((id) => new Types.ObjectId(id)),
    },
    nutrition: {
      totals,
      entryCount: nutrition?.entryCount ?? 0,
      calorieTarget: prefs?.calorieTarget ?? 2000,
    },
    water: {
      totalMl,
      targetMl: prefs?.waterTargetMl ?? 2500,
      entryCount: water.length,
    },
    activity: { steps, workoutMinutes, sleepMinutes },
    context: {
      weekday: localWeekdayIndex(localDate),
      calendarEventCount: calendarEvents.length,
      lastCalendarEventEndMin,
      weatherCondition: weatherEvent
        ? ((weatherEvent.metadata as Record<string, string>).conditionCode ?? null)
        : null,
    },
    eventCount: events.length,
    sources,
    generatedAt: new Date(),
  };

  const doc = await DailySummaryModel.findOneAndUpdate(
    { userId: uid, localDate },
    { $set: summary },
    { upsert: true, new: true },
  ).lean();

  return doc as DailySummaryDoc;
}

/**
 * Read a summary, building it if absent.
 *
 * Summaries are a cache. A cache miss must be indistinguishable from a hit, or the
 * AI layer starts silently reasoning over gaps.
 */
export async function getDailySummary(
  userId: string,
  localDate: LocalDate,
): Promise<DailySummaryDoc> {
  const existing = await DailySummaryModel.findOne({
    userId: new Types.ObjectId(userId),
    localDate,
  }).lean();

  if (existing) return existing as DailySummaryDoc;
  return buildDailySummary(userId, localDate);
}

export async function getSummariesBetween(
  userId: string,
  from: LocalDate,
  to: LocalDate,
): Promise<DailySummaryDoc[]> {
  return DailySummaryModel.find({
    userId: new Types.ObjectId(userId),
    localDate: { $gte: from, $lte: to },
  })
    .sort({ localDate: 1 })
    .lean<DailySummaryDoc[]>();
}

/**
 * Drop a day's cached summary so the next read rebuilds it.
 *
 * Every write that changes what a day looked like must call this. A summary is a
 * cache, and a cache nobody invalidates is just a wrong answer with good latency —
 * the Weekly Analysis chart and the History grid both read it directly.
 */
export async function invalidateDailySummary(
  userId: string,
  localDate: LocalDate,
): Promise<void> {
  await DailySummaryModel.deleteOne({
    userId: new Types.ObjectId(userId),
    localDate,
  });
}
