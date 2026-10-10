import { TurboModuleRegistry } from 'react-native';
import type { HealthSnapshot, SyncHealthInput } from '@synitheia/shared';
import type * as HealthConnect from 'react-native-health-connect';
import type { AggregateResult, AggregateResultRecordType } from 'react-native-health-connect';
import { dayBounds, type DayBounds } from './dayBounds.js';
import {
  READ_RECORD_TYPES,
  aggregateValue,
  availabilityOf,
  bodyFromLatest,
  grantOutcome,
  grantedReadTypes,
  sessionsStartingIn,
  snapshotForDay,
  workoutFromSession,
  type ExerciseSessionInput,
  type ReadRecordType,
  type SleepSessionInput,
} from './healthConnectNormalize.js';
import type { HealthConnectResult, HealthReader } from './types.js';

/**
 * Health Connect, read on the device. Android's counterpart to healthkit.ts.
 *
 * Read-only, always: only read permissions are requested and none that writes is declared
 * in the manifest, so the app is structurally incapable of changing the user's health
 * record. Nothing leaves the phone except through our own /health/sync.
 *
 * Kept deliberately thin. This is the one health file that cannot run outside an Android
 * app, so it only calls the library and hands the results over; every decision lives in
 * healthConnectNormalize.ts, where a test can reach it.
 *
 * The library is loaded by dynamic import, on first use, and only once its native module
 * is known to be in the build. On iPhone it must never be evaluated at all. On Android,
 * evaluating it without its native half throws — which has happened to other native
 * modules in this repo — and that throw cannot simply be caught: see `load()`.
 */

type Library = typeof HealthConnect;
type TimeRange = { operator: 'between'; startTime: string; endTime: string };

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back to look for a height or weight. Health Connect returns what it is allowed to. */
const BODY_LOOKBACK_DAYS = 365;

let loading: Promise<Library | null> | null = null;

/** Whether the library's native half is really in this build. Asking is free of side effects. */
function nativeModulePresent(): boolean {
  try {
    return TurboModuleRegistry.get('HealthConnect') != null;
  } catch {
    return false;
  }
}

/**
 * The library, or null when it cannot be used.
 *
 * The check comes BEFORE the import, and a try/catch around the import is not a
 * substitute for it. The library calls `TurboModuleRegistry.getEnforcing` as it is
 * evaluated, which throws when the native module is missing; Metro's module guard catches
 * that throw, reports it as a FATAL error — a crash in a release build — and resolves the
 * import with nothing. So an unlinked module would take the app down from the Health
 * switch, from every foreground sync, and from the background task. Not evaluating the
 * library is the only version of "unavailable" that is actually safe.
 */
function load(): Promise<Library | null> {
  loading ??= nativeModulePresent()
    ? import('react-native-health-connect').then(
        (library) => library,
        () => null,
      )
    : Promise.resolve(null);
  return loading;
}

/** The library, only if Health Connect is present and initialised on this phone. */
async function ready(): Promise<Library | null> {
  const library = await load();
  if (!library) return null;

  try {
    if (availabilityOf(await library.getSdkStatus()) !== 'available') return null;
    return (await library.initialize()) ? library : null;
  } catch {
    return null;
  }
}

function between(start: Date, end: Date): TimeRange {
  return { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() };
}

async function aggregate<T extends AggregateResultRecordType>(
  library: Library,
  recordType: T,
  range: TimeRange,
  pick: (result: AggregateResult<T>) => number | undefined,
): Promise<number | null> {
  const result = await library.aggregateRecord({ recordType, timeRangeFilter: range });
  return aggregateValue(result, pick(result));
}

async function sleepSessions(library: Library, range: TimeRange): Promise<SleepSessionInput[]> {
  return (await library.readRecords('SleepSession', { timeRangeFilter: range })).records;
}

async function exerciseSessions(
  library: Library,
  range: TimeRange,
): Promise<ExerciseSessionInput[]> {
  return (await library.readRecords('ExerciseSession', { timeRangeFilter: range })).records;
}

/**
 * One local day, or null when the day could not be read completely.
 *
 * Two different things look alike here and must not be treated alike:
 *
 *   - A type the user never granted. Not asked for at all; its field is null, which is
 *     the truth, and the day still syncs. That is what a partial grant is.
 *   - A read that FAILED on a type that was granted: the app went to the background
 *     mid-sync on a phone without background access, or Health Connect rate-limited it.
 *     That null would be a lie, and the server overwrites every field of a day it is
 *     sent — so a half-read day would erase what a complete sync stored earlier. Such a
 *     day is not sent at all, and the next full sync brings it up to date.
 */
async function readDay(
  library: Library,
  day: DayBounds,
  granted: ReadonlySet<ReadRecordType>,
): Promise<HealthSnapshot | null> {
  const range = between(day.start, day.end);
  // Noted rather than thrown, so one refused read does not abandon the others mid-flight.
  let failed = false;

  /** A granted type's reading; `absent`, without asking, for a type that was never granted. */
  const attempt = async <T>(
    type: ReadRecordType,
    read: () => Promise<T>,
    absent: T,
  ): Promise<T> => {
    if (!granted.has(type)) return absent;
    try {
      return await read();
    } catch {
      failed = true;
      return absent;
    }
  };

  const total = {
    steps: () => aggregate(library, 'Steps', range, (r) => r.COUNT_TOTAL),
    activeKcal: (within: TimeRange) =>
      aggregate(
        library,
        'ActiveCaloriesBurned',
        within,
        (r) => r.ACTIVE_CALORIES_TOTAL.inKilocalories,
      ),
    exerciseSeconds: () =>
      aggregate(library, 'ExerciseSession', range, (r) => r.EXERCISE_DURATION_TOTAL.inSeconds),
    restingBpm: () => aggregate(library, 'RestingHeartRate', range, (r) => r.BPM_AVG),
  };

  // Totals come from Health Connect's own aggregates, which de-duplicate across apps.
  // Summing raw records would count a phone and a watch as two walks.
  const [steps, activeKcal, exerciseSeconds, restingBpm, nights, sessions] = await Promise.all([
    attempt('Steps', total.steps, null),
    attempt('ActiveCaloriesBurned', () => total.activeKcal(range), null),
    attempt('ExerciseSession', total.exerciseSeconds, null),
    attempt('RestingHeartRate', total.restingBpm, null),
    // A night that ended today began before today's midnight, so look a day further back.
    attempt(
      'SleepSession',
      () => sleepSessions(library, between(new Date(day.start.getTime() - DAY_MS), day.end)),
      [],
    ),
    attempt('ExerciseSession', () => exerciseSessions(library, range), []),
  ]);

  const workouts: HealthSnapshot['workouts'] = [];
  for (const session of sessionsStartingIn(sessions, day)) {
    const during: TimeRange = {
      operator: 'between',
      startTime: session.startTime,
      endTime: session.endTime,
    };
    const energyKcal = await attempt('ActiveCaloriesBurned', () => total.activeKcal(during), null);
    const workout = workoutFromSession(session, energyKcal);
    if (workout) workouts.push(workout);
  }

  if (failed) return null;

  return snapshotForDay(day, {
    steps,
    activeKcal,
    exerciseSeconds,
    restingBpm,
    sleepSessions: nights,
    workouts,
  });
}

async function readBody(
  library: Library,
  granted: ReadonlySet<ReadRecordType>,
): Promise<SyncHealthInput['body']> {
  const latest = {
    timeRangeFilter: between(new Date(Date.now() - BODY_LOOKBACK_DAYS * DAY_MS), new Date()),
    ascendingOrder: false,
    pageSize: 1,
  };

  let heightMeters: number | null = null;
  let weightKg: number | null = null;

  // A failure here needs no special handling: a missing key is simply left out of the
  // request, and the server only sets the body fields it is given.
  if (granted.has('Height')) {
    try {
      heightMeters =
        (await library.readRecords('Height', latest)).records[0]?.height.inMeters ?? null;
    } catch {
      /* unreadable this time */
    }
  }
  if (granted.has('Weight')) {
    try {
      weightKg =
        (await library.readRecords('Weight', latest)).records[0]?.weight.inKilograms ?? null;
    } catch {
      /* unreadable this time */
    }
  }

  return bodyFromLatest({ heightMeters, weightKg });
}

async function isAvailable(): Promise<boolean> {
  return (await ready()) !== null;
}

/**
 * Ask Health Connect for read access.
 *
 * Unlike iOS, Android reports what was granted, so the result is read back from Health
 * Connect afterwards rather than taken from the request: the user can leave the sheet
 * half-way, and what matters is what the app can actually read.
 */
async function connect(): Promise<HealthConnectResult> {
  const library = await load();
  if (!library) return 'unavailable';

  let availability: ReturnType<typeof availabilityOf>;
  try {
    availability = availabilityOf(await library.getSdkStatus());
  } catch {
    return 'unavailable';
  }
  if (availability !== 'available') return availability;

  try {
    if (!(await library.initialize())) return 'unavailable';

    const reads = READ_RECORD_TYPES.map((recordType) => ({ accessType: 'read' as const, recordType }));

    try {
      await library.requestPermission([
        ...reads,
        { accessType: 'read', recordType: 'BackgroundAccessPermission' },
      ]);
    } catch {
      // A Health Connect too old to know about background access rejects the whole
      // request for the one permission it has never heard of. That must not cost the user
      // the connection: ask again for the data alone, and sync in the foreground only.
      await library.requestPermission(reads);
    }

    return grantOutcome(await library.getGrantedPermissions());
  } catch {
    return 'unauthorized';
  }
}

/**
 * Read the last `days` local days out of Health Connect.
 *
 * The whole window, every time, with no cursor — for the same reason as the iPhone reader:
 * health is not append-only, a watch that syncs late rewrites yesterday, and the server
 * upserts by day, so re-sending is free and always correct.
 */
async function readHealth(days: number): Promise<SyncHealthInput | null> {
  const library = await ready();
  if (!library) return null;

  let granted: ReadonlySet<ReadRecordType>;
  try {
    granted = grantedReadTypes(await library.getGrantedPermissions());
  } catch {
    return null;
  }
  // Nothing readable is nothing to send.
  if (granted.size === 0) return null;

  const snapshots: HealthSnapshot[] = [];
  // One day at a time. Health Connect rate-limits callers, and far more tightly in the
  // background; forty-odd calls in one burst is how a sync gets itself throttled.
  for (let i = 0; i < days; i += 1) {
    const snapshot = await readDay(library, dayBounds(i), granted);
    if (snapshot) snapshots.push(snapshot);
  }

  // Every day failed: a background run without background access, most likely.
  if (snapshots.length === 0) return null;

  return { body: await readBody(library, granted), days: snapshots };
}

export const healthConnectReader: HealthReader = { isAvailable, connect, readHealth };
