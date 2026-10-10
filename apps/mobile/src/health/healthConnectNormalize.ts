import { asLocalDate, type BodyMetrics, type HealthSnapshot } from '@synitheia/shared';
import type { DayBounds } from './dayBounds.js';
import { exerciseName } from './exerciseTypes.js';
import type { HealthConnectResult } from './types.js';

/**
 * Health Connect records → the same daily snapshot the iPhone reader produces.
 *
 * Everything in this file is pure, and that is the point of it existing. The module that
 * actually talks to Health Connect cannot run outside an Android app, so it is kept to
 * calls and hand-offs, and every decision worth getting right — what counts as sleep,
 * when "0" means "nothing", which readings are too absurd to pass on — lives here where
 * a test can reach it.
 */

/** The record types the app reads. The same seven things iPhone reads. */
export const READ_RECORD_TYPES = [
  'Steps',
  'ActiveCaloriesBurned',
  'ExerciseSession',
  'SleepSession',
  'RestingHeartRate',
  'Height',
  'Weight',
] as const;

export type ReadRecordType = (typeof READ_RECORD_TYPES)[number];

/**
 * The manifest permission behind each record type. Health Connect refuses a request for
 * a permission the manifest does not declare, so `app.json` is tested against this map.
 */
export const MANIFEST_PERMISSIONS: Readonly<Record<ReadRecordType, string>> = {
  Steps: 'android.permission.health.READ_STEPS',
  ActiveCaloriesBurned: 'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  ExerciseSession: 'android.permission.health.READ_EXERCISE',
  SleepSession: 'android.permission.health.READ_SLEEP',
  RestingHeartRate: 'android.permission.health.READ_RESTING_HEART_RATE',
  Height: 'android.permission.health.READ_HEIGHT',
  Weight: 'android.permission.health.READ_WEIGHT',
};

export const BACKGROUND_PERMISSION = 'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND';

/** The library's `SdkAvailabilityStatus`: 1 unavailable, 2 provider update required, 3 available. */
export function availabilityOf(sdkStatus: number): 'available' | 'update_required' | 'unavailable' {
  if (sdkStatus === 3) return 'available';
  if (sdkStatus === 2) return 'update_required';
  return 'unavailable';
}

/**
 * Connected means at least one of OUR data types can be read.
 *
 * Unlike iOS, Android says what was granted, so this can be honest: background access on
 * its own, or a type the app never reads, is not a connection.
 */
export function grantOutcome(
  granted: readonly { accessType: string; recordType: string }[],
): Extract<HealthConnectResult, 'connected' | 'unauthorized'> {
  const readable = new Set<string>(READ_RECORD_TYPES);
  return granted.some((p) => p.accessType === 'read' && readable.has(p.recordType))
    ? 'connected'
    : 'unauthorized';
}

/**
 * An aggregate's value, or null when no app contributed to it.
 *
 * Health Connect answers 0 for a period nobody recorded, which is indistinguishable from
 * a real zero unless you look at who contributed. Absent is not zero: a "0 steps" day
 * that never happened would complete nothing, but it WOULD make the low-activity rule
 * fire on a phone that simply has no step source.
 */
export function aggregateValue(
  result: { dataOrigins?: readonly string[] | null } | null | undefined,
  value: number | null | undefined,
): number | null {
  if (!result?.dataOrigins || result.dataOrigins.length === 0) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* ─────────────────────────────────── sleep ─────────────────────────────────── */

export interface SleepSessionInput {
  startTime: string;
  endTime: string;
  stages?: readonly { startTime: string; endTime: string; stage: number }[] | null;
}

/** `SleepStageType`: SLEEPING 2, LIGHT 4, DEEP 5, REM 6. Awake and out-of-bed are not sleep. */
const ASLEEP_STAGES: ReadonlySet<number> = new Set([2, 4, 5, 6]);

interface Span {
  start: number;
  end: number;
}

function span(startTime: string, endTime: string): Span | null {
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

/**
 * How long the user slept, for the day they woke up on.
 *
 * A night is attributed to the day its session ENDS in: sleep from 23:00 to 07:00 is last
 * night's sleep, read this morning, and belongs to today. Asleep time is the UNION of the
 * asleep intervals across every session, because a watch and a phone that both recorded
 * the night are two descriptions of one night, not sixteen hours of sleep.
 */
export function sleepForDay(
  sessions: readonly SleepSessionInput[],
  day: Pick<DayBounds, 'start' | 'end'>,
): { minutes: number | null; from: Date | null; to: Date | null } {
  const dayStart = day.start.getTime();
  const dayEnd = day.end.getTime();
  const asleep: Span[] = [];

  for (const session of sessions) {
    const whole = span(session.startTime, session.endTime);
    if (!whole || whole.end < dayStart || whole.end >= dayEnd) continue;

    const stages = session.stages ?? [];
    // A source that records no stages only knows "asleep from here to there".
    if (stages.length === 0) {
      asleep.push(whole);
      continue;
    }

    for (const stage of stages) {
      if (!ASLEEP_STAGES.has(stage.stage)) continue;
      const staged = span(stage.startTime, stage.endTime);
      if (!staged) continue;
      // Held inside its own session: a stage that spills past it is a source's bug, and
      // must not stretch the night.
      const start = Math.max(staged.start, whole.start);
      const end = Math.min(staged.end, whole.end);
      if (end > start) asleep.push({ start, end });
    }
  }

  if (asleep.length === 0) return { minutes: null, from: null, to: null };

  asleep.sort((a, b) => a.start - b.start);

  let total = 0;
  let current: Span = { ...asleep[0]! };
  for (const next of asleep.slice(1)) {
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
    } else {
      total += current.end - current.start;
      current = { ...next };
    }
  }
  total += current.end - current.start;

  const minutes = Math.round(total / 60_000);
  if (minutes <= 0 || minutes > 24 * 60) return { minutes: null, from: null, to: null };

  return {
    minutes,
    from: new Date(asleep[0]!.start),
    to: new Date(Math.max(...asleep.map((s) => s.end))),
  };
}

/* ────────────────────────────────── workouts ────────────────────────────────── */

export interface ExerciseSessionInput {
  startTime: string;
  endTime: string;
  exerciseType?: number | null;
}

type Workout = HealthSnapshot['workouts'][number];

/** A workout belongs to the day it started on. */
export function sessionsStartingIn<T extends { startTime: string }>(
  sessions: readonly T[],
  day: Pick<DayBounds, 'start' | 'end'>,
): T[] {
  return sessions.filter((session) => {
    const start = Date.parse(session.startTime);
    return Number.isFinite(start) && start >= day.start.getTime() && start < day.end.getTime();
  });
}

export function workoutFromSession(
  session: ExerciseSessionInput,
  energyKcal: number | null,
): Workout | null {
  const whole = span(session.startTime, session.endTime);
  if (!whole) return null;

  const minutes = Math.round((whole.end - whole.start) / 60_000);
  // Longer than a day is a session somebody forgot to stop, not a workout.
  if (minutes > 24 * 60) return null;

  return {
    kind: exerciseName(session.exerciseType),
    minutes,
    energyKcal: wholeInRange(energyKcal, 0, 20_000),
  };
}

/* ────────────────────────────────── snapshot ────────────────────────────────── */

/**
 * Round, and refuse anything outside what the shared schema accepts.
 *
 * Refuse, not clamp. The server validates every field's range and rejects the whole
 * payload on one violation, so an impossible number has to go — but turning 10,000,000
 * steps into "300,000 steps" would be inventing a reading. Null says what is true: there
 * is no usable value here.
 */
function wholeInRange(value: number | null | undefined, min: number, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded < min || rounded > max ? null : rounded;
}

export interface DayReadings {
  steps: number | null;
  activeKcal: number | null;
  exerciseSeconds: number | null;
  restingBpm: number | null;
  sleepSessions: readonly SleepSessionInput[];
  workouts: readonly Workout[];
}

export function snapshotForDay(day: DayBounds, readings: DayReadings): HealthSnapshot {
  const sleep = sleepForDay(readings.sleepSessions, day);

  return {
    localDate: asLocalDate(day.localDate),
    steps: wholeInRange(readings.steps, 0, 300_000),
    activeEnergyKcal: wholeInRange(readings.activeKcal, 0, 20_000),
    exerciseMinutes: wholeInRange(
      readings.exerciseSeconds == null ? null : readings.exerciseSeconds / 60,
      0,
      24 * 60,
    ),
    sleepMinutes: sleep.minutes,
    sleepStart: sleep.from,
    sleepEnd: sleep.to,
    restingHeartRate: wholeInRange(readings.restingBpm, 20, 220),
    // The server accepts at most 30 a day.
    workouts: readings.workouts.slice(0, 30),
  };
}

/**
 * Height and weight, only where Health Connect had a believable value.
 *
 * Absent keys are left out rather than set to null, because the server `$set`s only what
 * arrives: a missing weight must not blank a weight the user typed in by hand.
 */
export function bodyFromLatest(latest: {
  heightMeters: number | null;
  weightKg: number | null;
}): Partial<BodyMetrics> {
  const body: Partial<BodyMetrics> = {};

  // Health Connect stores height in metres; the domain speaks centimetres.
  const heightCm = latest.heightMeters == null ? null : Math.round(latest.heightMeters * 100);
  if (heightCm != null && heightCm >= 50 && heightCm <= 280) body.heightCm = heightCm;

  const weightKg = latest.weightKg == null ? null : Math.round(latest.weightKg * 10) / 10;
  if (weightKg != null && weightKg >= 20 && weightKg <= 500) body.weightKg = weightKg;

  return body;
}
