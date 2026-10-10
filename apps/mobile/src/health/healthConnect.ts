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
  sessionsStartingIn,
  snapshotForDay,
  workoutFromSession,
  type ExerciseSessionInput,
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
 * The library is loaded by dynamic import, on first use, for two reasons. On iPhone it
 * must never be evaluated at all. And on Android, importing it throws if its native
 * module did not link into the build — which has happened to other native modules in this
 * repo. Loaded lazily inside a catch, that failure reads as "Health Connect unavailable"
 * instead of taking down the app, or the background task, at startup.
 */

type Library = typeof HealthConnect;
type TimeRange = { operator: 'between'; startTime: string; endTime: string };

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back to look for a height or weight. Health Connect returns what it is allowed to. */
const BODY_LOOKBACK_DAYS = 365;

let loading: Promise<Library | null> | null = null;

function load(): Promise<Library | null> {
  loading ??= import('react-native-health-connect').then(
    (library) => library,
    () => null,
  );
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
  try {
    const result = await library.aggregateRecord({ recordType, timeRangeFilter: range });
    return aggregateValue(result, pick(result));
  } catch {
    // A type the user refused, or ANY read from the background without background access.
    // Absent, not zero.
    return null;
  }
}

async function sleepSessions(library: Library, range: TimeRange): Promise<SleepSessionInput[]> {
  try {
    return (await library.readRecords('SleepSession', { timeRangeFilter: range })).records;
  } catch {
    return [];
  }
}

async function exerciseSessions(
  library: Library,
  range: TimeRange,
): Promise<ExerciseSessionInput[]> {
  try {
    return (await library.readRecords('ExerciseSession', { timeRangeFilter: range })).records;
  } catch {
    return [];
  }
}

async function readDay(library: Library, day: DayBounds): Promise<HealthSnapshot> {
  const range = between(day.start, day.end);

  // Totals come from Health Connect's own aggregates, which de-duplicate across apps.
  // Summing raw records would count a phone and a watch as two walks.
  const [steps, activeKcal, exerciseSeconds, restingBpm, nights, sessions] = await Promise.all([
    aggregate(library, 'Steps', range, (r) => r.COUNT_TOTAL),
    aggregate(library, 'ActiveCaloriesBurned', range, (r) => r.ACTIVE_CALORIES_TOTAL.inKilocalories),
    aggregate(library, 'ExerciseSession', range, (r) => r.EXERCISE_DURATION_TOTAL.inSeconds),
    aggregate(library, 'RestingHeartRate', range, (r) => r.BPM_AVG),
    // A night that ended today began before today's midnight, so look a day further back.
    sleepSessions(library, between(new Date(day.start.getTime() - DAY_MS), day.end)),
    exerciseSessions(library, range),
  ]);

  const workouts: HealthSnapshot['workouts'] = [];
  for (const session of sessionsStartingIn(sessions, day)) {
    const energyKcal = await aggregate(
      library,
      'ActiveCaloriesBurned',
      { operator: 'between', startTime: session.startTime, endTime: session.endTime },
      (r) => r.ACTIVE_CALORIES_TOTAL.inKilocalories,
    );
    const workout = workoutFromSession(session, energyKcal);
    if (workout) workouts.push(workout);
  }

  return snapshotForDay(day, {
    steps,
    activeKcal,
    exerciseSeconds,
    restingBpm,
    sleepSessions: nights,
    workouts,
  });
}

async function readBody(library: Library): Promise<SyncHealthInput['body']> {
  const latest = {
    timeRangeFilter: between(new Date(Date.now() - BODY_LOOKBACK_DAYS * DAY_MS), new Date()),
    ascendingOrder: false,
    pageSize: 1,
  };

  let heightMeters: number | null = null;
  let weightKg: number | null = null;

  try {
    heightMeters = (await library.readRecords('Height', latest)).records[0]?.height.inMeters ?? null;
  } catch {
    /* not shared */
  }
  try {
    weightKg = (await library.readRecords('Weight', latest)).records[0]?.weight.inKilograms ?? null;
  } catch {
    /* not shared */
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

  const snapshots: HealthSnapshot[] = [];
  // One day at a time. Health Connect rate-limits callers, and far more tightly in the
  // background; forty-odd calls in one burst is how a sync gets itself throttled.
  for (let i = 0; i < days; i += 1) {
    snapshots.push(await readDay(library, dayBounds(i)));
  }

  return { body: await readBody(library), days: snapshots };
}

export const healthConnectReader: HealthReader = { isAvailable, connect, readHealth };
