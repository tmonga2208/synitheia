import { Types } from 'mongoose';
import {
  bodyInsight,
  calorieTargetFor,
  measureOf,
  todayLocalDate,
  type BodyInsight,
  type BodyMetrics,
  type CalorieGoal,
  type CalorieTarget,
  type HealthSnapshot,
  type LocalDate,
  type SyncHealthInput,
} from '@synitheia/shared';
import {
  DataSourceConnectionModel,
  HabitLogModel,
  HabitModel,
  HealthDayModel,
  UserPreferenceModel,
} from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import { invalidateDailySummary } from '../../context/aggregator.js';
import * as engine from '../../context/engine.js';
import { recomputeStreak } from '../habits/service.js';

interface AuthedUser {
  id: string;
  timezone: string;
}

/**
 * Health is read ONLY with a live consent record.
 *
 * The OS permission and our consent record are two different things: iOS remembers a grant
 * forever, while "Health & Activity" in Connected Context is the switch the user actually
 * believes they control. If those disagree, ours wins — otherwise turning the source off in
 * our UI would keep silently ingesting data because iOS still says yes.
 */
async function requireConsent(userId: Types.ObjectId): Promise<void> {
  const connection = await DataSourceConnectionModel.findOne({
    userId,
    source: 'health',
  }).lean();

  if (connection?.status !== 'connected') {
    throw AppError.forbidden('Health is not connected. Turn it on in Connected Context.');
  }
}

export async function sync(
  user: AuthedUser,
  input: SyncHealthInput,
): Promise<{ days: number; stepsApplied: number }> {
  const userId = new Types.ObjectId(user.id);
  await requireConsent(userId);

  if (input.body) {
    // $set only the keys Health actually returned. A missing weight must not blank a weight
    // the user typed in by hand — absent is not the same as zero.
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.body)) {
      if (value !== undefined && value !== null) set[`bodyMetrics.${key}`] = value;
    }

    if (Object.keys(set).length > 0) {
      set['bodyMetrics.updatedAt'] = new Date();
      await UserPreferenceModel.updateOne({ userId }, { $set: set }, { upsert: true });
    }
  }

  let stepsApplied = 0;

  for (const day of input.days) {
    // Upsert on (userId, localDate): re-reading today's steps ten times must leave one row.
    await HealthDayModel.updateOne(
      { userId, localDate: day.localDate },
      {
        $set: {
          steps: day.steps,
          activeEnergyKcal: day.activeEnergyKcal,
          exerciseMinutes: day.exerciseMinutes,
          sleepMinutes: day.sleepMinutes,
          restingHeartRate: day.restingHeartRate,
          workouts: day.workouts,
          syncedAt: new Date(),
        },
      },
      { upsert: true },
    );

    await emitEvents(user, day);
    stepsApplied += await applyStepsToHabits(user, userId, day);
  }

  await DataSourceConnectionModel.updateOne(
    { userId, source: 'health' },
    { $set: { lastSyncedAt: new Date(), lastSyncError: null } },
  );

  return { days: input.days.length, stepsApplied };
}

/**
 * Health onto the timeline.
 *
 * Emitted through the same idempotent path as everything else, so a re-sync updates the
 * existing event rather than stacking a second "12,431 steps" onto the user's day.
 */
async function emitEvents(user: AuthedUser, day: HealthSnapshot): Promise<void> {
  // Midday, so the event lands inside the day it describes regardless of timezone.
  const timestamp = new Date(`${day.localDate}T12:00:00.000Z`);

  if (day.steps != null && day.steps > 0) {
    await engine.emit({
      userId: user.id,
      source: 'health',
      timestamp,
      timezone: user.timezone,
      metadata: { type: 'steps.recorded', steps: day.steps, distanceM: null },
      dedupeKey: engine.dedupeKey('health', 'steps', day.localDate),
    });
  }

  // Only with a real interval. `sleep.detected` carries startedAt/endedAt, and inventing
  // them from a duration would put a fabricated bedtime on the user's timeline.
  if (day.sleepMinutes != null && day.sleepMinutes > 0 && day.sleepStart && day.sleepEnd) {
    await engine.emit({
      userId: user.id,
      source: 'health',
      timestamp: new Date(day.sleepEnd),
      timezone: user.timezone,
      metadata: {
        type: 'sleep.detected',
        durationMin: day.sleepMinutes,
        startedAt: day.sleepStart,
        endedAt: day.sleepEnd,
      },
      dedupeKey: engine.dedupeKey('health', 'sleep', day.localDate),
    });
  }

  for (const [index, workout] of day.workouts.entries()) {
    await engine.emit({
      userId: user.id,
      source: 'health',
      timestamp,
      timezone: user.timezone,
      metadata: {
        type: 'workout.detected',
        activity: workout.kind,
        durationMin: workout.minutes,
        calories: workout.energyKcal,
      },
      // Index in the key: two runs on one day are two events, not one overwriting the other.
      dedupeKey: engine.dedupeKey('health', 'workout', `${day.localDate}:${index}`),
    });
  }
}

/**
 * Steps into step habits. THIS is the point of connecting Health.
 *
 * Note this writes without asking, and that is not a violation of Detect → Suggest → Confirm.
 * The rule exists to stop the app INVENTING records from circumstantial evidence — "you were
 * near a café at 9am, shall I log ₹200?". A step count is not an inference; it is the
 * measurement the habit was always asking the user to copy in by hand. The user chose to
 * track steps, and connected Health. Making them tap "+500" twenty-four times to enter a
 * number the phone already knows would be the app failing at its one stated job.
 *
 * The count is REPLACED, not added to. Health's total for the day is authoritative and
 * already cumulative; adding it would double-count on every re-sync.
 */
async function applyStepsToHabits(
  user: AuthedUser,
  userId: Types.ObjectId,
  day: HealthSnapshot,
): Promise<number> {
  if (day.steps == null || day.steps <= 0) return 0;

  const habits = await HabitModel.find({ userId, archivedAt: null }).lean();
  const stepHabits = habits.filter((habit) => measureOf(habit) === 'steps');

  for (const habit of stepHabits) {
    const count = Math.min(day.steps, habit.targetCount * 10);

    await HabitLogModel.updateOne(
      { userId, habitId: habit._id, localDate: day.localDate },
      {
        $set: {
          count,
          targetCount: habit.targetCount,
          completedAt: count >= habit.targetCount ? new Date() : null,
          source: 'health',
        },
      },
      { upsert: true },
    );

    // Invalidate right after the log write, before recomputeStreak — a step sync
    // touches a day's flow percentage exactly like a manual habit log does, and if
    // recomputeStreak throws for a later habit in this loop, the day already written
    // must not be left stale behind that exception.
    await invalidateDailySummary(user.id, day.localDate as LocalDate);

    await recomputeStreak(user.id, String(habit._id), user.timezone);
  }

  return stepHabits.length;
}

// ─── The body ────────────────────────────────────────────────────────────────

export interface BodyReport {
  body: BodyMetrics;
  insight: BodyInsight;
  goal: CalorieGoal | null;
  /** What we would set the calorie target to, per goal. The user picks; we never apply it. */
  options: Record<CalorieGoal, CalorieTarget> | null;
  currentCalorieTarget: number;
  /** Today's activity, so the UI can say whether TDEE was measured or estimated. */
  today: { steps: number | null; activeEnergyKcal: number | null };
}

export async function bodyReport(user: AuthedUser): Promise<BodyReport> {
  const userId = new Types.ObjectId(user.id);
  const localDate = todayLocalDate(user.timezone);

  const [prefs, day] = await Promise.all([
    UserPreferenceModel.findOne({ userId }).lean(),
    HealthDayModel.findOne({ userId, localDate }).lean(),
  ]);

  const stored = prefs?.bodyMetrics;

  const body: BodyMetrics = {
    heightCm: stored?.heightCm ?? null,
    weightKg: stored?.weightKg ?? null,
    biologicalSex: (stored?.biologicalSex as BodyMetrics['biologicalSex']) ?? null,
    birthDate: (stored?.birthDate as BodyMetrics['birthDate']) ?? null,
  };

  const activity = {
    steps: day?.steps ?? null,
    activeEnergyKcal: day?.activeEnergyKcal ?? null,
  };

  const insight = bodyInsight(body, activity, localDate);

  const options =
    insight.tdee && insight.bmrKcal && body.biologicalSex
      ? {
          lose: calorieTargetFor(insight.tdee.kcal, 'lose', {
            basal: insight.bmrKcal,
            biologicalSex: body.biologicalSex,
          }),
          maintain: calorieTargetFor(insight.tdee.kcal, 'maintain', {
            basal: insight.bmrKcal,
            biologicalSex: body.biologicalSex,
          }),
          gain: calorieTargetFor(insight.tdee.kcal, 'gain', {
            basal: insight.bmrKcal,
            biologicalSex: body.biologicalSex,
          }),
        }
      : null;

  return {
    body,
    insight,
    goal: (prefs?.calorieGoal as CalorieGoal | null) ?? null,
    options,
    currentCalorieTarget: prefs?.calorieTarget ?? 2000,
    today: activity,
  };
}

/** The CONFIRM step. Nothing above ever writes calorieTarget — only this, on a real tap. */
export async function setCalorieGoal(
  user: AuthedUser,
  goal: CalorieGoal,
): Promise<BodyReport> {
  const userId = new Types.ObjectId(user.id);
  const report = await bodyReport(user);

  if (!report.options) {
    throw AppError.badRequest(
      `Cannot compute a calorie target yet — still missing: ${report.insight.missing.join(', ')}`,
    );
  }

  await UserPreferenceModel.updateOne(
    { userId },
    { $set: { calorieGoal: goal, calorieTarget: report.options[goal].kcal } },
    { upsert: true },
  );

  return bodyReport(user);
}

/** Height/sex/birth date that Health did not hold. Typed once, then it is known forever. */
export async function updateBody(
  user: AuthedUser,
  patch: Partial<BodyMetrics>,
): Promise<BodyReport> {
  const userId = new Types.ObjectId(user.id);

  const set: Record<string, unknown> = { 'bodyMetrics.updatedAt': new Date() };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) set[`bodyMetrics.${key}`] = value;
  }

  await UserPreferenceModel.updateOne({ userId }, { $set: set }, { upsert: true });
  return bodyReport(user);
}
