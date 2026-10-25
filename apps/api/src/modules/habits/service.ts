import { Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import {
  addLocalDays,
  awardsForHabitLog,
  completionRate,
  computeStreak,
  diffLocalDays,
  isHabitComplete,
  startOfLocalWeek,
  toLocalDate,
  todayLocalDate,
  type ClientId,
  type CreateHabitInput,
  type LocalDate,
  type LogHabitInput,
  type UpdateHabitInput,
} from '@synitheia/shared';
import { AppError } from '../../core/errors.js';
import { rethrowTakenId, withClientId } from '../../core/clientId.js';
import {
  HabitLogModel,
  HabitModel,
  type HabitDoc,
  type HabitHydrated,
  type HabitLogDoc,
} from '../../db/models.js';
import { invalidateDailySummary } from '../../context/aggregator.js';
import { dedupeKey, emit, retractByDedupeKey } from '../../context/engine.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { grantAwards } from '../xp/service.js';

/**
 * Hydrated (has .save()) vs lean (plain object) are kept as separate types on purpose
 * — casting between them compiles away a difference that is real at runtime.
 */
type HabitLean = HabitDoc & { _id: Types.ObjectId; createdAt: Date };

export async function listHabits(userId: string, includeArchived = false) {
  const query: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
  if (!includeArchived) query.archivedAt = null;

  return HabitModel.find(query).sort({ createdAt: 1 }).lean<HabitLean[]>();
}

export async function createHabit(user: AuthedUser, input: CreateHabitInput & ClientId) {
  const { id, ...fields } = input;
  const habit = await HabitModel.create(
    withClientId(id, {
      userId: new Types.ObjectId(user.id),
      ...fields,
      category: fields.category ?? null,
      unit: fields.unit ?? null,
      reminderTime: fields.reminderTime ?? null,
      currentStreak: 0,
      longestStreak: 0,
      archivedAt: null,
    }),
  ).catch(rethrowTakenId);

  /**
   * A new habit is scheduled from today, which moves `habits.scheduled` and therefore
   * the day's flow percentage without touching a single log. Today's cached rollup is
   * now wrong: the ring recomputes from live habits and drops to 50%, while the History
   * cell and the weekly bar keep reading a rollup that never heard about the new habit.
   *
   * Only today — `scheduledOn()` excludes a habit from every day before it existed, so
   * past rollups are still correct.
   */
  await invalidateDailySummary(user.id, todayLocalDate(user.timezone));

  return habit;
}

export async function updateHabit(
  user: AuthedUser,
  habitId: string,
  input: UpdateHabitInput,
) {
  const habit = await HabitModel.findOne({
    _id: new Types.ObjectId(habitId),
    userId: new Types.ObjectId(user.id),
  });

  if (!habit) throw AppError.notFound('Habit');

  Object.assign(habit, input);
  await habit.save();

  /**
   * Changing targetCount changes what "complete" means. Existing logs keep the target
   * they were recorded against — raising a goal from 1 to 3 must not retroactively
   * un-complete last week and silently erase the user's streak.
   */
  if (input.targetCount !== undefined || input.frequency !== undefined) {
    return recomputeStreak(user.id, habitId, user.timezone);
  }

  return habit;
}

/** Soft-archive. A habit's logs are the user's history and are never deleted with it. */
export async function archiveHabit(user: AuthedUser, habitId: string) {
  const result = await HabitModel.updateOne(
    { _id: new Types.ObjectId(habitId), userId: new Types.ObjectId(user.id) },
    { $set: { archivedAt: new Date() } },
  );

  if (result.matchedCount === 0) throw AppError.notFound('Habit');

  /**
   * Archiving moves `scheduledOn()` too, so the same rollup staleness applies — but
   * only forward, and only ever by one day.
   *
   * `scheduledOn()` keeps an archived habit on any day whose midnight precedes
   * `archivedAt`, which is every day the habit actually existed for. Past rollups are
   * therefore still correct and deliberately left alone: re-deriving a year of
   * summaries to change nothing would be pure churn. Days after today have no cached
   * rollup at all — nothing builds a summary for a day that has not happened.
   *
   * That leaves today, which flips for a user whose local date is already ahead of UTC
   * when they archive. Cheap to invalidate unconditionally, and wrong to skip.
   */
  await invalidateDailySummary(user.id, todayLocalDate(user.timezone));
}

export interface HabitCompletionAwardInput {
  userId: string;
  /**
   * The RESOLVED habit document's `_id`, never a string off a request.
   * `objectIdSchema` is `/^[a-f\d]{24}$/i`, case-INSENSITIVE, so `/habits/6A6E…/log`
   * and `/habits/6a6e…/log` both validate and both resolve to the same habit — but a
   * key built from the raw string would differ between them, and the unique index
   * cannot catch keys that genuinely differ. Taking an ObjectId rather than a string
   * makes that mistake unavailable to callers rather than merely discouraged.
   */
  habitId: Types.ObjectId;
  localDate: LocalDate;
  /** The streak as recomputed AFTER this completion, not the pre-log value. */
  currentStreak: number;
  logger?: Pick<FastifyBaseLogger, 'warn'>;
}

/**
 * Everything a completed habit earns, granted in one place.
 *
 * This exists as a function rather than a block inside `logHabit` because a habit can
 * be completed down more than one path: the manual log, and a Health step sync that
 * fills a step-measured habit without the user touching the app. Both are completions
 * by every definition the rest of the app uses — both write `completedAt`, both
 * recompute the streak — so both must earn the same XP. Copying the block would let the
 * two drift, and a missing award has no symptom loud enough for anyone to notice the
 * drift had happened.
 *
 * The caller decides WHETHER the habit is complete; this decides what that is worth.
 *
 * XP is a nicety layered on top of a write that has already landed — a ledger hiccup
 * must never surface as a failed habit tap or a failed health sync — so the grant is
 * swallowed and logged here, the same contract as `today/routes.ts`'s "detectors must
 * not break Today" wrapping. Swallowed, but never silent: `grantAwards`' own doc
 * comment is explicit that a failure like "no User document for this id" is
 * deliberately loud, and dropping it here would undo that. A caller with no logger
 * (only the direct-caller test files, never a real route) still gets `console.warn`.
 */
export async function grantHabitCompletionAwards(
  input: HabitCompletionAwardInput,
): Promise<void> {
  const { userId, habitId, localDate, currentStreak, logger } = input;

  try {
    const [scheduled, dayLogs] = await Promise.all([
      scheduledOn(userId, localDate),
      logsForDate(userId, localDate),
    ]);

    await grantAwards(
      userId,
      awardsForHabitLog({
        habitId: habitId.toString(),
        localDate,
        complete: true,
        currentStreak,
        scheduledCount: scheduled.length,
        completedCount: dayLogs.filter(isHabitComplete).length,
      }),
    );
  } catch (error) {
    (logger ?? console).warn({ err: error }, 'failed to grant habit XP');
  }
}

/**
 * Log progress on a habit.
 *
 * `count` is absolute, not a delta. This is what makes the endpoint idempotent: a
 * client on a flaky connection that retries a "+1" would otherwise increment twice.
 * The `increment` convenience (for the `+` button in the UI) is resolved to an
 * absolute count server-side, against the current stored value.
 */
export async function logHabit(
  user: AuthedUser,
  habitId: string,
  input: LogHabitInput,
  /**
   * Optional so every direct caller in this codebase's tests keeps compiling
   * unchanged; the real route passes `req.log`, the same facility `today/routes.ts`
   * already uses for "this must not take down the main write" failures.
   */
  logger?: Pick<FastifyBaseLogger, 'warn'>,
  /**
   * `'inferred'` when a confirmed suggestion is doing the logging. Recorded on the log
   * forever, so the app can always say what the user entered and what it proposed.
   */
  source: 'manual' | 'inferred' = 'manual',
): Promise<{ log: HabitLogDoc; habit: HabitHydrated }> {
  const habit = await HabitModel.findOne({
    _id: new Types.ObjectId(habitId),
    userId: new Types.ObjectId(user.id),
  });

  if (!habit) throw AppError.notFound('Habit');
  if (habit.archivedAt) throw AppError.badRequest('This habit is archived');

  const localDate = (input.localDate ?? todayLocalDate(user.timezone)) as LocalDate;

  // A client with a skewed clock must not be able to log into the future and inflate
  // a streak. The server's notion of the user's today is authoritative.
  if (localDate > todayLocalDate(user.timezone)) {
    throw AppError.badRequest('Cannot log a habit for a future date');
  }

  const existing = await HabitLogModel.findOne({
    userId: new Types.ObjectId(user.id),
    habitId: habit._id,
    localDate,
  });

  const nextCount =
    input.count !== undefined
      ? input.count
      : Math.max(0, (existing?.count ?? 0) + (input.increment ?? 1));

  const complete = nextCount >= habit.targetCount;

  // Upsert against the (userId, habitId, localDate) unique index — the double-tap
  // and the offline-replay both land here and collapse onto one row.
  const log = await HabitLogModel.findOneAndUpdate(
    { userId: new Types.ObjectId(user.id), habitId: habit._id, localDate },
    {
      $set: {
        count: nextCount,
        targetCount: habit.targetCount,
        completedAt: complete ? (existing?.completedAt ?? new Date()) : null,
        source,
      },
    },
    { upsert: true, new: true },
  );

  const updated = await recomputeStreak(user.id, habitId, user.timezone);

  await invalidateDailySummary(user.id, localDate);

  // Stepped back below the target (an undo in the app): that day is no longer completed,
  // so its completion leaves the timeline. XP stays; awards are keyed per habit and day, so
  // ticking it again does not pay twice.
  const wasComplete = existing !== null && existing.count >= habit.targetCount;
  if (wasComplete && !complete) {
    await retractByDedupeKey(user.id, dedupeKey('manual', 'habit', `${habitId}:${localDate}`));
  }

  if (complete) {
    await grantHabitCompletionAwards({
      userId: user.id,
      habitId: habit._id,
      localDate,
      currentStreak: updated.currentStreak,
      logger,
    });

    await emit({
      userId: user.id,
      source: 'manual',
      timestamp: log.completedAt ?? new Date(),
      timezone: user.timezone,
      refId: habit._id,
      // Keyed on the habit and the DAY, not on the log id — re-completing the same
      // habit on the same day must update one timeline row, not append a second.
      dedupeKey: dedupeKey('manual', 'habit', `${habitId}:${localDate}`),
      metadata: {
        type: 'habit.completed',
        habitId: habitId,
        habitName: habit.name,
        habitColor: habit.color,
        count: nextCount,
        targetCount: habit.targetCount,
        streakAfter: updated.currentStreak,
      },
    });
  }

  return { log, habit: updated };
}

/**
 * Recompute a habit's cached streak from its logs.
 *
 * HabitLog is the source of truth; currentStreak on Habit is a cache that exists so
 * the habit list can render without scanning the log collection. It is recomputed on
 * every write rather than incremented, because an incremental counter drifts the
 * moment anything unusual happens (a backdated log, an edited target, a deleted day)
 * and a wrong streak is the single most visible bug a habit tracker can ship.
 */
export async function recomputeStreak(
  userId: string,
  habitId: string,
  /**
   * The user's timezone, passed in explicitly. A streak depends entirely on what
   * "today" means to the *user* — a habit has no timezone of its own, and defaulting
   * to the server's would break the streak of every user not living in UTC.
   */
  timezone: string,
): Promise<HabitHydrated> {
  const habit = await HabitModel.findOne({
    _id: new Types.ObjectId(habitId),
    userId: new Types.ObjectId(userId),
  });

  if (!habit) throw AppError.notFound('Habit');

  const logs = await HabitLogModel.find(
    { userId: new Types.ObjectId(userId), habitId: habit._id },
    { localDate: 1, count: 1, targetCount: 1 },
  ).lean();

  const completedDates = logs
    .filter((l) => isHabitComplete(l))
    .map((l) => l.localDate as LocalDate);

  const { current, longest } = computeStreak({
    completedDates,
    frequency: habit.frequency as 'daily' | 'weekly',
    today: todayLocalDate(timezone),
  });

  habit.currentStreak = current;
  habit.longestStreak = Math.max(longest, habit.longestStreak);
  await habit.save();

  return habit;
}

export async function logsForDate(userId: string, localDate: LocalDate) {
  return HabitLogModel.find({
    userId: new Types.ObjectId(userId),
    localDate,
  }).lean();
}

export async function logsBetween(
  userId: string,
  from: LocalDate,
  to: LocalDate,
) {
  return HabitLogModel.find({
    userId: new Types.ObjectId(userId),
    localDate: { $gte: from, $lte: to },
  }).lean();
}

/**
 * The habits scheduled on a given day.
 *
 * A habit created today was not "missed" yesterday — it did not exist. Scoping the
 * denominator to habits that existed on the day is what keeps completion rates
 * honest, and stops a new user seeing "0% — you missed 14 habits" on day one.
 */
export async function scheduledOn(
  userId: string,
  localDate: LocalDate,
): Promise<HabitLean[]> {
  const habits = await listHabits(userId, true);
  const dayEnd = new Date(`${addLocalDays(localDate, 1)}T00:00:00Z`);

  return habits.filter((h) => {
    const createdAt = h.createdAt;
    if (createdAt && createdAt.getTime() >= dayEnd.getTime()) return false;
    if (h.archivedAt && h.archivedAt.getTime() < dayEnd.getTime() - 86_400_000) {
      return false;
    }
    return true;
  });
}

export interface HabitHistory {
  logs: { localDate: LocalDate; count: number; targetCount: number; complete: boolean }[];
  /** Periods the habit actually existed for — a habit created last Tuesday is not
   *  scored against the whole month. */
  scheduledPeriods: number;
  completedPeriods: number;
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
}

/**
 * A habit's real history, so the detail screen can show a completion rate it can stand
 * behind. The tempting shortcut — streak ÷ days-since-created — actively misreports: a
 * habit kept 5 days out of 7 has a current streak of 1 and would render as 14%.
 */
export async function historyFor(
  user: AuthedUser,
  habitId: string,
  days = 30,
): Promise<HabitHistory> {
  const habit = await HabitModel.findOne({
    _id: new Types.ObjectId(habitId),
    userId: new Types.ObjectId(user.id),
  }).lean<HabitLean | null>();

  if (!habit) throw AppError.notFound('Habit');

  const today = todayLocalDate(user.timezone);
  const windowStart = addLocalDays(today, -(days - 1));

  const raw = await HabitLogModel.find(
    {
      userId: new Types.ObjectId(user.id),
      habitId: habit._id,
      localDate: { $gte: windowStart, $lte: today },
    },
    { localDate: 1, count: 1, targetCount: 1 },
  )
    .sort({ localDate: 1 })
    .lean();

  /**
   * The window starts at whichever came first: the habit's creation, or its earliest
   * log. Clamping to createdAt alone looks right but is wrong — logs may be BACKDATED
   * (the API allows it), and a habit created today with six backdated logs would then
   * be scored against a single day and report a flawless 100% while hiding a gap. A
   * log existing on a day is proof the habit was being tracked on that day.
   */
  const createdLocal = toLocalDate(habit.createdAt, user.timezone);
  const earliestLog = raw[0]?.localDate as LocalDate | undefined;
  const habitStart =
    earliestLog && earliestLog < createdLocal ? earliestLog : createdLocal;
  const from = habitStart > windowStart ? habitStart : windowStart;

  const logs = raw.map((l) => ({
    localDate: l.localDate as LocalDate,
    count: l.count,
    targetCount: l.targetCount,
    complete: isHabitComplete(l),
  }));

  const step = habit.frequency === 'weekly' ? 7 : 1;
  const scheduledPeriods = Math.max(1, Math.ceil((diffLocalDays(from, today) + 1) / step));
  const completedPeriods = new Set(
    logs.filter((l) => l.complete).map((l) => (step === 7 ? startOfLocalWeek(l.localDate) : l.localDate)),
  ).size;

  return {
    logs,
    scheduledPeriods,
    completedPeriods,
    completionRate: completionRate(completedPeriods, scheduledPeriods),
    currentStreak: habit.currentStreak,
    longestStreak: habit.longestStreak,
  };
}
