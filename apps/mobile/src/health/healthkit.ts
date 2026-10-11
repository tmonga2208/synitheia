import {
  CategoryValueSleepAnalysis,
  WorkoutActivityType,
  getBiologicalSexAsync,
  getDateOfBirthAsync,
  getMostRecentQuantitySample,
  isHealthDataAvailableAsync,
  queryCategorySamples,
  queryStatisticsForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import type {
  ObjectTypeIdentifier,
  QuantityTypeIdentifier,
} from '@kingstinct/react-native-healthkit';
import {
  asLocalDate,
  type BiologicalSex,
  type BodyMetrics,
  type HealthSnapshot,
  type SyncHealthInput,
} from '@synitheia/shared';
import { dayBounds } from './dayBounds.js';
import type { HealthConnectResult, HealthReader } from './types.js';

/**
 * Apple Health, read on the device.
 *
 * HealthKit data NEVER leaves the phone except through our own /health/sync, and only for
 * the fields listed below. Read-only, always: `requestAuthorization` is called with an empty
 * `toShare`, so the app is structurally incapable of modifying the user's health record even
 * if a future bug tried to.
 *
 * iOS only. Android's counterpart is healthConnect.ts; both produce the same normalized
 * `SyncHealthInput`, the server knows nothing about either, and the rest of the app
 * reaches whichever one applies through healthStore.ts.
 *
 * The library (@kingstinct/react-native-healthkit v14) is built on Nitro modules: the API is
 * free functions with options objects, identifiers are the full `HKQuantityTypeIdentifier…`
 * strings, and every reading comes back as a `{ unit, quantity }` pair rather than a bare
 * number — which is why durations are divided out of seconds explicitly below.
 */

/** The full HealthKit identifier strings. camelCase shorthands were removed in v14. */
const ID = {
  steps: 'HKQuantityTypeIdentifierStepCount',
  activeEnergy: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  exercise: 'HKQuantityTypeIdentifierAppleExerciseTime',
  restingHr: 'HKQuantityTypeIdentifierRestingHeartRate',
  height: 'HKQuantityTypeIdentifierHeight',
  bodyMass: 'HKQuantityTypeIdentifierBodyMass',
} as const satisfies Record<string, QuantityTypeIdentifier>;

const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis' as const;

const READ_PERMISSIONS: readonly ObjectTypeIdentifier[] = [
  ID.steps,
  ID.activeEnergy,
  ID.exercise,
  ID.restingHr,
  ID.height,
  ID.bodyMass,
  SLEEP,
  'HKCharacteristicTypeIdentifierBiologicalSex',
  'HKCharacteristicTypeIdentifierDateOfBirth',
  'HKWorkoutTypeIdentifier',
];

async function isAvailable(): Promise<boolean> {
  try {
    return await isHealthDataAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Ask iOS for read access.
 *
 * iOS deliberately does NOT tell you whether the user granted read access — that would leak
 * medical information by inference ("they refused to share pregnancy data"). So a `true`
 * here means "the sheet was shown", not "we can see anything". The only honest way to know
 * whether we actually have data is to read and see if anything comes back, which is exactly
 * what sync does.
 */
async function requestPermissions(): Promise<boolean> {
  if (!(await isAvailable())) return false;

  try {
    // Empty `toShare`. We only ever read.
    await requestAuthorization({ toShare: [], toRead: READ_PERMISSIONS });
    return true;
  } catch {
    return false;
  }
}

async function sumQuantity(
  identifier: QuantityTypeIdentifier,
  unit: string,
  start: Date,
  end: Date,
): Promise<number | null> {
  try {
    const result = await queryStatisticsForQuantity(identifier, ['cumulativeSum'], {
      filter: { date: { startDate: start, endDate: end } },
      unit: unit as never,
    });

    const value = result?.sumQuantity?.quantity;
    return typeof value === 'number' ? value : null;
  } catch {
    // A type the user declined, or one this device never records. Absent, not zero.
    return null;
  }
}

async function averageQuantity(
  identifier: QuantityTypeIdentifier,
  unit: string,
  start: Date,
  end: Date,
): Promise<number | null> {
  try {
    const result = await queryStatisticsForQuantity(identifier, ['discreteAverage'], {
      filter: { date: { startDate: start, endDate: end } },
      unit: unit as never,
    });

    const value = result?.averageQuantity?.quantity;
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

/** Asleep only — time in bed reading a book is not sleep, and Apple distinguishes them. */
const ASLEEP_VALUES = new Set<number>([
  CategoryValueSleepAnalysis.asleepUnspecified,
  CategoryValueSleepAnalysis.asleepCore,
  CategoryValueSleepAnalysis.asleepDeep,
  CategoryValueSleepAnalysis.asleepREM,
]);

async function readSleep(
  start: Date,
  end: Date,
): Promise<{ minutes: number | null; from: Date | null; to: Date | null }> {
  try {
    // Sleep for "today" starts LAST night, so the window opens 18 hours before midnight.
    const from = new Date(start.getTime() - 18 * 60 * 60 * 1000);

    const samples = await queryCategorySamples(SLEEP, {
      filter: { date: { startDate: from, endDate: end } },
      limit: 0,
      ascending: true,
    });

    const asleep = samples.filter((s) => ASLEEP_VALUES.has(s.value as number));
    if (asleep.length === 0) return { minutes: null, from: null, to: null };

    let ms = 0;
    let earliest = new Date(asleep[0]!.startDate).getTime();
    let latest = new Date(asleep[0]!.endDate).getTime();

    for (const sample of asleep) {
      const s = new Date(sample.startDate).getTime();
      const e = new Date(sample.endDate).getTime();
      ms += e - s;
      earliest = Math.min(earliest, s);
      latest = Math.max(latest, e);
    }

    return {
      minutes: Math.round(ms / 60_000),
      from: new Date(earliest),
      to: new Date(latest),
    };
  } catch {
    return { minutes: null, from: null, to: null };
  }
}

async function readWorkouts(start: Date, end: Date): Promise<HealthSnapshot['workouts']> {
  try {
    const workouts = await queryWorkoutSamples({
      filter: { date: { startDate: start, endDate: end } },
      limit: 0,
    });

    return workouts.map((w) => ({
      // The enum is numeric, so `String()` of it is "37". Reverse-map to the name the
      // schema promises ("running"); the server still understands the old numbers for
      // events already stored.
      kind: WorkoutActivityType[w.workoutActivityType] ?? 'workout',
      // `duration` is now a Quantity in seconds, not a bare number of seconds.
      minutes: Math.round((w.duration?.quantity ?? 0) / 60),
      energyKcal: w.totalEnergyBurned?.quantity ?? null,
    }));
  } catch {
    return [];
  }
}

const SEX_MAP: Record<string, BiologicalSex> = {
  male: 'male',
  female: 'female',
  other: 'other',
};

async function readBody(): Promise<Partial<BodyMetrics>> {
  const body: Partial<BodyMetrics> = {};

  try {
    const height = await getMostRecentQuantitySample(ID.height, 'm' as never);
    // Apple stores height in metres; the domain speaks centimetres.
    if (height?.quantity) body.heightCm = Math.round(height.quantity * 100);
  } catch {
    /* not shared */
  }

  try {
    const mass = await getMostRecentQuantitySample(ID.bodyMass, 'kg' as never);
    if (mass?.quantity) body.weightKg = Math.round(mass.quantity * 10) / 10;
  } catch {
    /* not shared */
  }

  try {
    const sex = await getBiologicalSexAsync();
    const mapped = SEX_MAP[String(sex).toLowerCase()];
    // 'notSet' maps to nothing. An unset sex must stay unknown — see bodyInsight().
    if (mapped) body.biologicalSex = mapped;
  } catch {
    /* not shared */
  }

  try {
    const dob = await getDateOfBirthAsync();
    if (dob instanceof Date && !Number.isNaN(dob.getTime())) {
      body.birthDate = asLocalDate(
        `${dob.getFullYear()}-${String(dob.getMonth() + 1).padStart(2, '0')}-${String(
          dob.getDate(),
        ).padStart(2, '0')}`,
      );
    }
  } catch {
    /* not shared */
  }

  return body;
}

/**
 * Read the last `days` local days out of Apple Health.
 *
 * Re-reads the whole window every time rather than tracking a cursor. Health is not
 * append-only — a watch that syncs late rewrites yesterday, and today's step count changes
 * all day. The server upserts on (userId, localDate), so re-sending a day is free and
 * always correct, which is a far better trade than a cursor that silently goes stale.
 */
async function readHealth(days: number): Promise<SyncHealthInput | null> {
  if (!(await isAvailable())) return null;

  const snapshots: HealthSnapshot[] = [];

  for (let i = 0; i < days; i += 1) {
    const { start, end, localDate } = dayBounds(i);

    const [steps, activeEnergy, exercise, restingHr, sleep, workouts] = await Promise.all([
      sumQuantity(ID.steps, 'count', start, end),
      sumQuantity(ID.activeEnergy, 'kcal', start, end),
      sumQuantity(ID.exercise, 'min', start, end),
      averageQuantity(ID.restingHr, 'count/min', start, end),
      readSleep(start, end),
      readWorkouts(start, end),
    ]);

    snapshots.push({
      localDate: asLocalDate(localDate),
      steps: steps == null ? null : Math.round(steps),
      activeEnergyKcal: activeEnergy == null ? null : Math.round(activeEnergy),
      exerciseMinutes: exercise == null ? null : Math.round(exercise),
      sleepMinutes: sleep.minutes,
      sleepStart: sleep.from,
      sleepEnd: sleep.to,
      restingHeartRate: restingHr == null ? null : Math.round(restingHr),
      workouts,
    });
  }

  return { body: await readBody(), days: snapshots };
}

/**
 * Two grants, in order: iOS's, then ours. Asking iOS first means a user who declines the
 * system sheet never gets a "connected" row promising data we cannot read.
 */
async function connect(): Promise<HealthConnectResult> {
  if (!(await isAvailable())) return 'unavailable';
  return (await requestPermissions()) ? 'connected' : 'unauthorized';
}

export const healthkitReader: HealthReader = { isAvailable, connect, readHealth };
