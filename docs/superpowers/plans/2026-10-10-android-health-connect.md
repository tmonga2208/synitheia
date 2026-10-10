# Android Health via Health Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Android, connecting Health reads steps, workouts, sleep, active calories, resting heart rate, weight and height from Health Connect and syncs them exactly as the iPhone reader does.

**Architecture:** One platform-neutral module (`healthStore`) becomes the only health import for the rest of the app and picks a reader by platform. The new Android reader is a thin layer over `react-native-health-connect`, loaded by dynamic import, feeding pure functions that turn Health Connect records into the shared `HealthSnapshot`; the pure functions carry the tests. A small local Expo config plugin declares the manifest entries Health Connect requires and writes a trampoline activity for its policy link.

**Tech Stack:** TypeScript, React Native 0.81 / Expo SDK 54 (New Architecture), `react-native-health-connect` 4.1.3, `expo-build-properties`, vitest, Expo config plugins (CommonJS), Kotlin (one generated file), Android SDK command-line tools and emulator for verification.

**Spec:** `docs/superpowers/specs/2026-10-10-android-health-connect-design.md`

## Global Constraints

- Read-only. No Health Connect write permission is declared or requested anywhere.
- Exactly seven read types, the same as iPhone: steps, workouts, sleep, active calories, resting heart rate, weight, height. Plus `READ_HEALTH_DATA_IN_BACKGROUND`.
- New dependencies: `react-native-health-connect` (`^4.1.3`) and `expo-build-properties` (the SDK 54 version `npx expo install` picks). No others.
- Android `minSdkVersion` becomes 26.
- The Android library is loaded only by dynamic `import()`. It is never imported statically; `import type` is fine. It must never be evaluated on iPhone.
- "Absent, not zero": a refused or throwing type is `null` for that day, and an aggregate with no contributing app is `null`, never `0`.
- A reading outside the shared schema's bounds is `null`, not clamped: one impossible number must not make the server reject the whole sync.
- The iPhone reader's behaviour does not change.
- Local days come from `dayBounds`; `localDate` strings go through `asLocalDate`.
- `react-native-health-connect` is NOT added to `plugins` in `app.json`. Our own plugin replaces it.
- Comments explain why, in the surrounding code's style.
- Run `pnpm check` from the repo root before every commit that touches code. It must pass.
- Until a real phone has been used, describe the result as "built and emulator-tested, not verified on a device" (or "built, not run on any Android device" if the emulator step could not be completed).

## Review Focus

Conditions most likely to bite a person using this, each pinned by a test in the task named:

1. **A day with no health data** must sync as "no data", not as zero steps, or a rest day is invented and the low-activity rule fires on a phone that simply has no step source. Task 4 (`aggregateValue`), Task 5.
2. **Two sources recording the same night** (a watch and a phone) must not double the sleep. Task 4.
3. **An impossible reading from a misbehaving source** (resting heart rate 0, ten million steps, a 3 kg adult) must not fail the whole sync against the server's bounds. Task 4.
4. **A phone whose Health Connect has no background-access permission** must still be able to connect. Task 5.
5. **A partial grant** (only workouts allowed) must still sync what was granted. Task 6.

Also tested: the library failing to load reads as "unavailable" rather than crashing (Task 5), and iPhone never touches the Android reader (Task 6).

## Deviations from the spec

- **One server string changes.** The spec says no server change. `workoutHabit.ts` hard-codes "from Apple Health" in a suggestion's evidence, which would be shown on Android. Task 3 makes it platform-neutral. The API needs a redeploy for that wording to reach production.
- **The sync runner's "nothing to send" test widens.** It currently looks only at steps, active energy and sleep, so a user who granted only workouts would never sync. Task 6 includes exercise minutes, resting heart rate and workouts.

---

## File Structure

```
apps/mobile/src/health/
  types.ts                         HealthConnectResult, HealthReader            (new, Task 4)
  dayBounds.ts            (+test)  local-day windows                            (new, Task 1)
  exerciseTypes.ts        (+test)  Health Connect exercise codes → names        (new, Task 2)
  healthConnectNormalize.ts (+test) pure: records → snapshot, outcomes          (new, Task 4)
  healthConnect.ts        (+2 tests) Android reader, thin                       (new, Task 5)
  healthStore.ts          (+test)  the only module the app imports              (new, Task 6)
  healthkit.ts                     iPhone reader, exports `healthkitReader`     (modified, Tasks 1, 6)
  useHealthSync.ts                 loses connectHealth                          (modified, Task 6)
apps/mobile/src/sync/runHealthSync.ts (+test)                                   (modified, Task 6)
apps/mobile/plugins/
  withHealthConnectRationale.js (+test)                                         (new, Task 7)
apps/mobile/app.json, package.json; pnpm-lock.yaml                              (Tasks 5, 7)
apps/mobile/app/privacy.tsx, body.tsx, (tabs)/index.tsx                         (Tasks 6, 8)
apps/api/src/context/detectors/workoutHabit.ts (+test), workoutMatch.test.ts    (Tasks 2, 3)
ARCHITECTURE.md                                                                 (Task 11)
```

All commands run from the repo root of this worktree unless a step says otherwise. Before Task 1, run `pnpm install --frozen-lockfile && pnpm --filter @synitheia/shared build` once.

---

### Task 1: Local-day windows in their own module

**Files:**
- Create: `apps/mobile/src/health/dayBounds.ts`
- Test: `apps/mobile/src/health/dayBounds.test.ts`
- Modify: `apps/mobile/src/health/healthkit.ts` (remove its private `dayBounds`, import this one)

**Interfaces:**
- Produces: `interface DayBounds { start: Date; end: Date; localDate: string }` and `dayBounds(daysAgo: number, now?: Date): DayBounds`

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/health/dayBounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dayBounds } from './dayBounds.js';

describe('dayBounds', () => {
  // Built from local-time parts, so every assertion holds in whatever zone the tests run.
  const afternoon = new Date(2026, 6, 12, 15, 30);

  it('covers today from local midnight to the next local midnight', () => {
    const { start, end, localDate } = dayBounds(0, afternoon);

    expect(localDate).toBe('2026-07-12');
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 6, 12]);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    expect([end.getMonth(), end.getDate(), end.getHours()]).toEqual([6, 13, 0]);
  });

  it('steps back whole local days', () => {
    expect(dayBounds(1, afternoon).localDate).toBe('2026-07-11');
    expect(dayBounds(6, afternoon).localDate).toBe('2026-07-06');
  });

  it('crosses a month and a year boundary', () => {
    expect(dayBounds(1, new Date(2026, 7, 1, 9, 0)).localDate).toBe('2026-07-31');
    expect(dayBounds(1, new Date(2027, 0, 1, 0, 5)).localDate).toBe('2026-12-31');
  });

  it('pads single-digit months and days', () => {
    expect(dayBounds(0, new Date(2026, 0, 5, 12, 0)).localDate).toBe('2026-01-05');
  });

  it('gives the same day one minute before midnight as at noon', () => {
    expect(dayBounds(0, new Date(2026, 6, 12, 23, 59)).localDate).toBe('2026-07-12');
    expect(dayBounds(0, new Date(2026, 6, 12, 0, 0)).localDate).toBe('2026-07-12');
  });

  it('makes consecutive days share a boundary, so nothing falls between them', () => {
    expect(dayBounds(1, afternoon).end.getTime()).toBe(dayBounds(0, afternoon).start.getTime());
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/health/dayBounds.test.ts`
Expected: FAIL — cannot load `./dayBounds.js`.

- [ ] **Step 3: Implement**

`apps/mobile/src/health/dayBounds.ts`:

```ts
export interface DayBounds {
  start: Date;
  end: Date;
  /** `YYYY-MM-DD` in the device's own zone. */
  localDate: string;
}

/**
 * Local midnight-to-midnight, in the device's own zone — the same day the app means.
 *
 * Shared by both platform readers so "Tuesday" is one thing however the health store is
 * asked. `now` is a parameter only so the windows can be tested without the clock.
 */
export function dayBounds(daysAgo: number, now: Date = new Date()): DayBounds {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const localDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
    start.getDate(),
  ).padStart(2, '0')}`;

  return { start, end, localDate };
}
```

In `apps/mobile/src/health/healthkit.ts`: delete the private `dayBounds` function together with its one-line doc comment (`/** Local midnight-to-midnight, in the device's own zone — the same day the app means. */`), and add this import after the `@synitheia/shared` import block:

```ts
import { dayBounds } from './dayBounds.js';
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/health/dayBounds.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
pnpm check
git add apps/mobile/src/health/dayBounds.ts apps/mobile/src/health/dayBounds.test.ts apps/mobile/src/health/healthkit.ts
git commit -m "refactor(mobile): local-day windows in their own module, shared by health readers"
```

---

### Task 2: Health Connect exercise types → the names iPhone sends

**Files:**
- Create: `apps/mobile/src/health/exerciseTypes.ts`
- Test: `apps/mobile/src/health/exerciseTypes.test.ts`
- Modify: `apps/api/src/context/detectors/workoutMatch.test.ts` (rows only)

**Interfaces:**
- Produces: `exerciseName(exerciseType: number | null | undefined): string` and `EXERCISE_NAMES: readonly string[]`

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/health/exerciseTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EXERCISE_NAMES, exerciseName } from './exerciseTypes.js';

describe('exerciseName', () => {
  it.each([
    [56, 'running'],
    [57, 'running'],
    [79, 'walking'],
    [8, 'cycling'],
    [9, 'cycling'],
    [73, 'swimming'],
    [74, 'swimming'],
    [83, 'yoga'],
    [70, 'traditionalStrengthTraining'],
    [81, 'traditionalStrengthTraining'],
    [37, 'hiking'],
    [48, 'pilates'],
    [16, 'dance'],
    [36, 'highIntensityIntervalTraining'],
    [25, 'elliptical'],
    [53, 'rowing'],
    [54, 'rowing'],
  ])('maps Health Connect type %i to %s', (code, name) => {
    expect(exerciseName(code)).toBe(name);
  });

  it.each([0, 2, 64, 999, -1, null, undefined, Number.NaN])(
    'calls an unmapped type (%s) a plain workout',
    (code) => {
      // Only a habit with a generic name ("Workout", "Gym") matches this on the server.
      expect(exerciseName(code)).toBe('workout');
    },
  );

  it('only ever emits names the server schema accepts', () => {
    // workoutSchema.kind is 1 to 60 characters.
    for (const name of [...EXERCISE_NAMES, 'workout']) {
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(60);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/health/exerciseTypes.test.ts`
Expected: FAIL — cannot load `./exerciseTypes.js`.

- [ ] **Step 3: Implement**

`apps/mobile/src/health/exerciseTypes.ts`:

```ts
/**
 * Health Connect exercise types → the activity names HealthKit uses.
 *
 * Health Connect identifies an exercise by number (`ExerciseSessionRecord.EXERCISE_TYPE_*`).
 * The server never sees which phone a workout came from: its workout → habit matching
 * works on the NAME, and it was written against the names iPhone sends. So Android sends
 * those same names, and nothing on the server has to know Health Connect exists.
 *
 * Deliberately a short list. Health Connect has dozens of gym-machine and team-sport types;
 * only the ones a habit name can plausibly match are worth naming, and everything else is
 * a plain "workout".
 */
const NAMES: Readonly<Record<number, string>> = {
  8: 'cycling', //  BIKING
  9: 'cycling', //  BIKING_STATIONARY
  16: 'dance', //  DANCING
  25: 'elliptical',
  36: 'highIntensityIntervalTraining',
  37: 'hiking',
  48: 'pilates',
  53: 'rowing',
  54: 'rowing', //  ROWING_MACHINE
  56: 'running',
  57: 'running', //  RUNNING_TREADMILL
  70: 'traditionalStrengthTraining', //  STRENGTH_TRAINING
  73: 'swimming', //  SWIMMING_OPEN_WATER
  74: 'swimming', //  SWIMMING_POOL
  79: 'walking',
  81: 'traditionalStrengthTraining', //  WEIGHTLIFTING
  83: 'yoga',
};

export function exerciseName(exerciseType: number | null | undefined): string {
  return (exerciseType != null && NAMES[exerciseType]) || 'workout';
}

/** Every specific name this module can emit. For tests that pin the contract. */
export const EXERCISE_NAMES: readonly string[] = [...new Set(Object.values(NAMES))];
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/health/exerciseTypes.test.ts`
Expected: PASS.

- [ ] **Step 5: Pin the contract on the server side**

Append to `apps/api/src/context/detectors/workoutMatch.test.ts`. These rows pass against the existing implementation; their job is to fail if someone later changes the matching in a way that breaks the names Android sends.

```ts

describe('names the Android reader sends', () => {
  // apps/mobile/src/health/exerciseTypes.ts maps Health Connect's numeric exercise types
  // onto these. They are the same names iPhone sends, which is the whole contract.
  it.each([
    ['Morning run', 'running', 'specific'],
    ['Walk the dog', 'walking', 'specific'],
    ['Bike to work', 'cycling', 'specific'],
    ['Swim', 'swimming', 'specific'],
    ['Yoga', 'yoga', 'specific'],
    ['Lift weights', 'traditionalStrengthTraining', 'specific'],
    ['Weekend hike', 'hiking', 'specific'],
    ['Pilates', 'pilates', 'specific'],
    ['Dance class', 'dance', 'specific'],
    ['Gym', 'elliptical', 'generic'],
    ['Workout', 'rowing', 'generic'],
    ['Exercise', 'highIntensityIntervalTraining', 'generic'],
    ['Gym', 'workout', 'generic'],
  ] as const)('%s ← %s is a %s match', (habit, activity, expected) => {
    expect(matchWorkout(habit, activity)).toBe(expected);
  });

  it('does not offer a specific habit for an unnamed workout', () => {
    expect(matchWorkout('Morning run', 'workout')).toBeNull();
  });
});
```

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors/workoutMatch.test.ts`
Expected: PASS (existing tests plus 14 new).

- [ ] **Step 6: Commit**

```bash
pnpm check
git add apps/mobile/src/health/exerciseTypes.ts apps/mobile/src/health/exerciseTypes.test.ts apps/api/src/context/detectors/workoutMatch.test.ts
git commit -m "feat(mobile): map Health Connect exercise types to the activity names iPhone sends"
```

---

### Task 3: A workout suggestion that does not say "Apple Health" on Android

**Files:**
- Modify: `apps/api/src/context/detectors/workoutHabit.ts` (one string)
- Test: `apps/api/src/context/detectors/workoutHabit.test.ts` (two assertions)

- [ ] **Step 1: Change the expectations first**

In `apps/api/src/context/detectors/workoutHabit.test.ts`, replace both occurrences of

```ts
'Running, 32 min, from Apple Health'
```

with

```ts
'Running, 32 min, from your health data'
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors/workoutHabit.test.ts`
Expected: FAIL in 2 tests — received `'Running, 32 min, from Apple Health'`.

- [ ] **Step 3: Change the label**

In `apps/api/src/context/detectors/workoutHabit.ts`, replace

```ts
          label: `${displayActivity(meta.activity ?? '')}, ${minutes} min, from Apple Health`,
```

with

```ts
          // Not "Apple Health": the server cannot tell which phone a workout came from,
          // and on Android this evidence is read by someone who has never had one.
          label: `${displayActivity(meta.activity ?? '')}, ${minutes} min, from your health data`,
```

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors`
Expected: PASS.

```bash
pnpm check
git add apps/api/src/context/detectors/workoutHabit.ts apps/api/src/context/detectors/workoutHabit.test.ts
git commit -m "fix(api): workout evidence no longer names Apple Health"
```

---

### Task 4: Pure functions — Health Connect records into a daily snapshot

**Files:**
- Create: `apps/mobile/src/health/types.ts`
- Create: `apps/mobile/src/health/healthConnectNormalize.ts`
- Test: `apps/mobile/src/health/healthConnectNormalize.test.ts`

**Interfaces:**
- Consumes: `DayBounds` (Task 1), `exerciseName` (Task 2)
- Produces, from `types.ts`:
  - `type HealthConnectResult = 'connected' | 'unavailable' | 'unauthorized' | 'update_required'`
  - `interface HealthReader { isAvailable(): Promise<boolean>; connect(): Promise<HealthConnectResult>; readHealth(days: number): Promise<SyncHealthInput | null> }`
- Produces, from `healthConnectNormalize.ts`:
  - `READ_RECORD_TYPES` (the seven record-type strings), `MANIFEST_PERMISSIONS: Record<ReadRecordType, string>`, `BACKGROUND_PERMISSION: string`
  - `availabilityOf(sdkStatus: number): 'available' | 'update_required' | 'unavailable'`
  - `grantOutcome(granted: readonly { accessType: string; recordType: string }[]): 'connected' | 'unauthorized'`
  - `aggregateValue(result: { dataOrigins?: readonly string[] | null } | null | undefined, value: number | null | undefined): number | null`
  - `interface SleepSessionInput`, `sleepForDay(sessions, day): { minutes: number | null; from: Date | null; to: Date | null }`
  - `interface ExerciseSessionInput`, `sessionsStartingIn<T extends { startTime: string }>(sessions: readonly T[], day): T[]`, `workoutFromSession(session, energyKcal): Workout | null`
  - `interface DayReadings`, `snapshotForDay(day: DayBounds, readings: DayReadings): HealthSnapshot`
  - `bodyFromLatest(latest: { heightMeters: number | null; weightKg: number | null }): Partial<BodyMetrics>`

- [ ] **Step 1: Create `types.ts`**

```ts
import type { SyncHealthInput } from '@synitheia/shared';

/**
 * Why a connect attempt ended the way it did.
 *
 * `unavailable`      this device has no health store the app can talk to: an iPad, Android
 *                    below 9, or a build the Android module did not link into.
 * `update_required`  Android 9 to 13 only: Health Connect is a separate app there, and it
 *                    is missing or too old. The user can fix this from the Play Store.
 * `unauthorized`     the store is there but nothing can be read. On iPhone this is almost
 *                    always the HealthKit entitlement being stripped at signing — Apple
 *                    only grants it to a PAID developer account — or "Don't Allow". On
 *                    Android it means no data type was granted.
 */
export type HealthConnectResult = 'connected' | 'unavailable' | 'unauthorized' | 'update_required';

/** What one platform's health store has to provide. */
export interface HealthReader {
  isAvailable(): Promise<boolean>;
  /** Ask the OS for access. Never throws. */
  connect(): Promise<HealthConnectResult>;
  /** The last `days` local days, or null when there is nothing to read from. Never throws. */
  readHealth(days: number): Promise<SyncHealthInput | null>;
}
```

- [ ] **Step 2: Write the failing test**

`apps/mobile/src/health/healthConnectNormalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dayBounds } from './dayBounds.js';
import {
  BACKGROUND_PERMISSION,
  MANIFEST_PERMISSIONS,
  READ_RECORD_TYPES,
  aggregateValue,
  availabilityOf,
  bodyFromLatest,
  grantOutcome,
  sessionsStartingIn,
  sleepForDay,
  snapshotForDay,
  workoutFromSession,
} from './healthConnectNormalize.js';

/** Sunday 12 July 2026, device-local. */
const DAY = dayBounds(0, new Date(2026, 6, 12, 15, 0));
/** An ISO instant at a local wall-clock time in July 2026. */
const at = (dayOfMonth: number, hour: number, minute = 0): string =>
  new Date(2026, 6, dayOfMonth, hour, minute).toISOString();

describe('the permission lists', () => {
  it('reads exactly the seven types iPhone reads', () => {
    expect([...READ_RECORD_TYPES].sort()).toEqual(
      [
        'ActiveCaloriesBurned',
        'ExerciseSession',
        'Height',
        'RestingHeartRate',
        'SleepSession',
        'Steps',
        'Weight',
      ].sort(),
    );
  });

  it('names a manifest permission for every type, and none of them writes', () => {
    for (const type of READ_RECORD_TYPES) {
      expect(MANIFEST_PERMISSIONS[type]).toMatch(/^android\.permission\.health\.READ_[A-Z_]+$/);
    }
    expect(BACKGROUND_PERMISSION).toBe('android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND');
  });
});

describe('availabilityOf', () => {
  it.each([
    [3, 'available'],
    [2, 'update_required'],
    [1, 'unavailable'],
    [0, 'unavailable'],
    [99, 'unavailable'],
  ] as const)('SDK status %i → %s', (status, expected) => {
    expect(availabilityOf(status)).toBe(expected);
  });
});

describe('grantOutcome', () => {
  const read = (recordType: string) => ({ accessType: 'read', recordType });

  it('is connected when at least one data type can be read', () => {
    expect(grantOutcome([read('ExerciseSession')])).toBe('connected');
    expect(grantOutcome(READ_RECORD_TYPES.map(read))).toBe('connected');
  });

  it('is not connected when nothing was granted', () => {
    expect(grantOutcome([])).toBe('unauthorized');
  });

  it('is not connected on background access alone — there would be nothing to read', () => {
    expect(grantOutcome([read('BackgroundAccessPermission')])).toBe('unauthorized');
  });

  it('ignores write grants and types the app never asked for', () => {
    expect(grantOutcome([{ accessType: 'write', recordType: 'Steps' }])).toBe('unauthorized');
    expect(grantOutcome([read('BloodPressure')])).toBe('unauthorized');
  });
});

describe('aggregateValue', () => {
  it('is null when no app contributed — no data is not zero', () => {
    // Health Connect answers 0 for a day nobody recorded. Passing that on would invent a
    // rest day and fire the low-activity rule on a phone with no step source at all.
    expect(aggregateValue({ dataOrigins: [] }, 0)).toBeNull();
    expect(aggregateValue({ dataOrigins: null }, 0)).toBeNull();
    expect(aggregateValue({}, 4321)).toBeNull();
    expect(aggregateValue(null, 4321)).toBeNull();
  });

  it('keeps a real zero from a real source', () => {
    expect(aggregateValue({ dataOrigins: ['com.fitbit'] }, 0)).toBe(0);
  });

  it('keeps the value when something contributed', () => {
    expect(aggregateValue({ dataOrigins: ['android'] }, 4321)).toBe(4321);
  });

  it('is null for a value that is not a finite number', () => {
    expect(aggregateValue({ dataOrigins: ['android'] }, undefined)).toBeNull();
    expect(aggregateValue({ dataOrigins: ['android'] }, Number.NaN)).toBeNull();
    expect(aggregateValue({ dataOrigins: ['android'] }, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('sleepForDay', () => {
  it('counts the night that ended this morning, even though it began yesterday', () => {
    const sleep = sleepForDay([{ startTime: at(11, 23), endTime: at(12, 7) }], DAY);

    expect(sleep.minutes).toBe(480);
    expect(sleep.from?.toISOString()).toBe(at(11, 23));
    expect(sleep.to?.toISOString()).toBe(at(12, 7));
  });

  it('does not count tonight, which ends tomorrow', () => {
    expect(sleepForDay([{ startTime: at(12, 23), endTime: at(13, 7) }], DAY).minutes).toBeNull();
  });

  it('counts only asleep stages when the source recorded stages', () => {
    const sleep = sleepForDay(
      [
        {
          startTime: at(11, 23),
          endTime: at(12, 7),
          stages: [
            { startTime: at(11, 23), endTime: at(12, 2), stage: 4 }, //  light, 180 min
            { startTime: at(12, 2), endTime: at(12, 2, 30), stage: 1 }, //  awake
            { startTime: at(12, 2, 30), endTime: at(12, 4), stage: 5 }, //  deep, 90 min
            { startTime: at(12, 4), endTime: at(12, 6), stage: 6 }, //  REM, 120 min
            { startTime: at(12, 6), endTime: at(12, 7), stage: 3 }, //  out of bed
          ],
        },
      ],
      DAY,
    );

    expect(sleep.minutes).toBe(390);
    // The first and last ASLEEP instants, not the session's edges.
    expect(sleep.from?.toISOString()).toBe(at(11, 23));
    expect(sleep.to?.toISOString()).toBe(at(12, 6));
  });

  it('does not double a night two sources both recorded', () => {
    const sleep = sleepForDay(
      [
        { startTime: at(11, 22, 45), endTime: at(12, 6, 50) }, //  the phone
        { startTime: at(11, 23), endTime: at(12, 7) }, //  the watch
      ],
      DAY,
    );

    // The union, 22:45 to 07:00 — not 485 + 480.
    expect(sleep.minutes).toBe(495);
  });

  it('adds an afternoon nap to the night', () => {
    const sleep = sleepForDay(
      [
        { startTime: at(11, 23), endTime: at(12, 7) },
        { startTime: at(12, 14), endTime: at(12, 14, 40) },
      ],
      DAY,
    );

    expect(sleep.minutes).toBe(520);
    expect(sleep.to?.toISOString()).toBe(at(12, 14, 40));
  });

  it('is null, not zero, when there was no sleep to count', () => {
    expect(sleepForDay([], DAY)).toEqual({ minutes: null, from: null, to: null });
    expect(
      sleepForDay(
        [
          {
            startTime: at(11, 23),
            endTime: at(12, 7),
            stages: [{ startTime: at(11, 23), endTime: at(12, 7), stage: 1 }],
          },
        ],
        DAY,
      ).minutes,
    ).toBeNull();
  });

  it('ignores a session with unreadable or backwards times', () => {
    expect(
      sleepForDay(
        [
          { startTime: 'not a date', endTime: at(12, 7) },
          { startTime: at(12, 7), endTime: at(12, 3) },
        ],
        DAY,
      ).minutes,
    ).toBeNull();
  });

  it('keeps a stage that spills outside its session inside the session', () => {
    const sleep = sleepForDay(
      [
        {
          startTime: at(12, 1),
          endTime: at(12, 5),
          stages: [{ startTime: at(11, 20), endTime: at(12, 9), stage: 2 }],
        },
      ],
      DAY,
    );
    expect(sleep.minutes).toBe(240);
  });

  it('treats an empty stage list like no stage list', () => {
    expect(
      sleepForDay([{ startTime: at(11, 23), endTime: at(12, 7), stages: [] }], DAY).minutes,
    ).toBe(480);
  });

  it('gives a session ending exactly at midnight to the new day', () => {
    const midnight = DAY.start.toISOString();
    const nextMidnight = DAY.end.toISOString();

    expect(sleepForDay([{ startTime: at(11, 20), endTime: midnight }], DAY).minutes).toBe(240);
    expect(sleepForDay([{ startTime: at(12, 20), endTime: nextMidnight }], DAY).minutes).toBeNull();
  });
});

describe('workouts', () => {
  it('turns an exercise session into a workout with the iPhone name', () => {
    expect(
      workoutFromSession({ startTime: at(12, 7), endTime: at(12, 7, 32), exerciseType: 56 }, 310.4),
    ).toEqual({ kind: 'running', minutes: 32, energyKcal: 310 });
  });

  it('leaves the energy null when Health Connect has none for the session', () => {
    expect(
      workoutFromSession({ startTime: at(12, 7), endTime: at(12, 7, 30), exerciseType: 83 }, null),
    ).toEqual({ kind: 'yoga', minutes: 30, energyKcal: null });
  });

  it('calls an unmapped or missing type a plain workout', () => {
    expect(
      workoutFromSession({ startTime: at(12, 7), endTime: at(12, 8), exerciseType: 64 }, null)?.kind,
    ).toBe('workout');
    expect(workoutFromSession({ startTime: at(12, 7), endTime: at(12, 8) }, null)?.kind).toBe(
      'workout',
    );
  });

  it('drops a session with unreadable, backwards or absurd times', () => {
    expect(workoutFromSession({ startTime: 'x', endTime: at(12, 8), exerciseType: 56 }, null)).toBeNull();
    expect(
      workoutFromSession({ startTime: at(12, 8), endTime: at(12, 7), exerciseType: 56 }, null),
    ).toBeNull();
    // Longer than a day: a session someone forgot to stop is not a workout.
    expect(
      workoutFromSession({ startTime: at(10, 7), endTime: at(12, 8), exerciseType: 56 }, null),
    ).toBeNull();
  });

  it('refuses an impossible energy figure rather than passing it on', () => {
    const session = { startTime: at(12, 7), endTime: at(12, 8), exerciseType: 56 };
    expect(workoutFromSession(session, -5)?.energyKcal).toBeNull();
    expect(workoutFromSession(session, 50_000)?.energyKcal).toBeNull();
    expect(workoutFromSession(session, Number.NaN)?.energyKcal).toBeNull();
  });

  it('keeps only sessions that start inside the day', () => {
    const sessions = [
      { startTime: at(11, 23, 30), endTime: at(12, 0, 30) }, //  began yesterday
      { startTime: at(12, 7), endTime: at(12, 8) },
      { startTime: at(13, 0), endTime: at(13, 1) }, //  tomorrow
      { startTime: 'garbage', endTime: at(12, 8) },
    ];
    expect(sessionsStartingIn(sessions, DAY)).toEqual([sessions[1]]);
  });
});

describe('snapshotForDay', () => {
  const empty = {
    steps: null,
    activeKcal: null,
    exerciseSeconds: null,
    restingBpm: null,
    sleepSessions: [],
    workouts: [],
  };

  it('assembles a day in the shape the server takes', () => {
    const snapshot = snapshotForDay(DAY, {
      steps: 4321.6,
      activeKcal: 412.2,
      exerciseSeconds: 1830,
      restingBpm: 57.4,
      sleepSessions: [{ startTime: at(11, 23), endTime: at(12, 7) }],
      workouts: [{ kind: 'running', minutes: 30, energyKcal: 300 }],
    });

    expect(snapshot).toEqual({
      localDate: '2026-07-12',
      steps: 4322,
      activeEnergyKcal: 412,
      exerciseMinutes: 31,
      sleepMinutes: 480,
      sleepStart: new Date(at(11, 23)),
      sleepEnd: new Date(at(12, 7)),
      restingHeartRate: 57,
      workouts: [{ kind: 'running', minutes: 30, energyKcal: 300 }],
    });
  });

  it('keeps absent as absent — every field null, no workouts', () => {
    expect(snapshotForDay(DAY, empty)).toEqual({
      localDate: '2026-07-12',
      steps: null,
      activeEnergyKcal: null,
      exerciseMinutes: null,
      sleepMinutes: null,
      sleepStart: null,
      sleepEnd: null,
      restingHeartRate: null,
      workouts: [],
    });
  });

  it('keeps a real zero', () => {
    expect(snapshotForDay(DAY, { ...empty, steps: 0 }).steps).toBe(0);
  });

  it.each([
    ['ten million steps', { steps: 10_000_000 }, 'steps'],
    ['negative steps', { steps: -4 }, 'steps'],
    ['a resting heart rate of 0', { restingBpm: 0 }, 'restingHeartRate'],
    ['a resting heart rate of 400', { restingBpm: 400 }, 'restingHeartRate'],
    ['100,000 active kcal', { activeKcal: 100_000 }, 'activeEnergyKcal'],
    ['30 hours of exercise in a day', { exerciseSeconds: 30 * 3600 }, 'exerciseMinutes'],
  ] as const)('turns %s into null instead of failing the sync', (_label, readings, field) => {
    // The server validates every field's range and rejects the WHOLE payload on one
    // violation. One broken source must not cost the user the rest of their week.
    expect(snapshotForDay(DAY, { ...empty, ...readings })[field]).toBeNull();
  });

  it('sends at most the 30 workouts a day the server accepts', () => {
    const workouts = Array.from({ length: 40 }, () => ({
      kind: 'walking',
      minutes: 5,
      energyKcal: null,
    }));
    expect(snapshotForDay(DAY, { ...empty, workouts }).workouts).toHaveLength(30);
  });
});

describe('bodyFromLatest', () => {
  it('converts metres to centimetres and keeps weight to one decimal', () => {
    expect(bodyFromLatest({ heightMeters: 1.756, weightKg: 70.26 })).toEqual({
      heightCm: 176,
      weightKg: 70.3,
    });
  });

  it('leaves out what Health Connect did not have, so a typed value is never blanked', () => {
    expect(bodyFromLatest({ heightMeters: null, weightKg: 70 })).toEqual({ weightKg: 70 });
    expect(bodyFromLatest({ heightMeters: null, weightKg: null })).toEqual({});
  });

  it('leaves out an impossible measurement', () => {
    expect(bodyFromLatest({ heightMeters: 17.5, weightKg: 3 })).toEqual({});
    expect(bodyFromLatest({ heightMeters: Number.NaN, weightKg: Number.NaN })).toEqual({});
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/health/healthConnectNormalize.test.ts`
Expected: FAIL — cannot load `./healthConnectNormalize.js`.

- [ ] **Step 4: Implement**

`apps/mobile/src/health/healthConnectNormalize.ts`:

```ts
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
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/health/healthConnectNormalize.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm check
git add apps/mobile/src/health/types.ts apps/mobile/src/health/healthConnectNormalize.ts apps/mobile/src/health/healthConnectNormalize.test.ts
git commit -m "feat(mobile): pure Health Connect normalisers — sleep, workouts, daily snapshot, grants"
```

---

### Task 5: The Android reader

**Files:**
- Modify: `apps/mobile/package.json`, `pnpm-lock.yaml` (two dependencies)
- Create: `apps/mobile/src/health/healthConnect.ts`
- Test: `apps/mobile/src/health/healthConnect.test.ts`, `apps/mobile/src/health/healthConnect.unlinked.test.ts`
- Modify: `apps/mobile/src/health/exerciseTypes.test.ts` (one test pinned to the library's constants)

**Interfaces:**
- Consumes: everything Task 4 produces; `dayBounds` (Task 1); `HealthReader`, `HealthConnectResult` (Task 4)
- Produces: `healthConnectReader: HealthReader`

- [ ] **Step 1: Install the two dependencies**

```bash
cd apps/mobile && npx expo install react-native-health-connect expo-build-properties && cd ../..
git diff --stat
```

Expected: `apps/mobile/package.json` gains `react-native-health-connect` (4.1.x) and `expo-build-properties`; `pnpm-lock.yaml` changes.

`expo install` may also add both names to `plugins` in `apps/mobile/app.json`. Task 7 owns that file, so undo any change it made there now:

```bash
git checkout apps/mobile/app.json
```

- [ ] **Step 2: Pin the exercise map to the library's own constants**

Append to `apps/mobile/src/health/exerciseTypes.test.ts`:

```ts

describe('the codes, against the library', () => {
  // Loaded with Node's own loader: this is the library's compiled constants file, which
  // is plain data, and it must not go through the React Native entry point.
  const { ExerciseType } = createRequire(import.meta.url)(
    'react-native-health-connect/lib/commonjs/constants',
  ) as { ExerciseType: Record<string, number> };

  it.each([
    ['RUNNING', 'running'],
    ['RUNNING_TREADMILL', 'running'],
    ['WALKING', 'walking'],
    ['BIKING', 'cycling'],
    ['BIKING_STATIONARY', 'cycling'],
    ['SWIMMING_POOL', 'swimming'],
    ['SWIMMING_OPEN_WATER', 'swimming'],
    ['YOGA', 'yoga'],
    ['STRENGTH_TRAINING', 'traditionalStrengthTraining'],
    ['WEIGHTLIFTING', 'traditionalStrengthTraining'],
    ['HIKING', 'hiking'],
    ['PILATES', 'pilates'],
    ['DANCING', 'dance'],
    ['HIGH_INTENSITY_INTERVAL_TRAINING', 'highIntensityIntervalTraining'],
    ['ELLIPTICAL', 'elliptical'],
    ['ROWING', 'rowing'],
    ['ROWING_MACHINE', 'rowing'],
  ])('ExerciseType.%s is %s', (constant, name) => {
    expect(ExerciseType[constant]).toBeTypeOf('number');
    expect(exerciseName(ExerciseType[constant])).toBe(name);
  });
});
```

and add to the top of that file:

```ts
import { createRequire } from 'node:module';
```

Run: `pnpm --filter @synitheia/mobile exec vitest run src/health/exerciseTypes.test.ts`
Expected: PASS. If a row fails, the number in `exerciseTypes.ts` is wrong for this version of the library: fix the number there, not the test.

- [ ] **Step 3: Write the failing reader tests**

`apps/mobile/src/health/healthConnect.unlinked.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

// What importing the library does on a build its native module did not link into.
vi.mock('react-native-health-connect', () => {
  throw new Error("The package 'react-native-health-connect' doesn't seem to be linked.");
});

const { healthConnectReader } = await import('./healthConnect.js');

describe('when the Health Connect module is not in the build', () => {
  it('reads as unavailable instead of crashing the app or the background task', async () => {
    expect(await healthConnectReader.isAvailable()).toBe(false);
    expect(await healthConnectReader.connect()).toBe('unavailable');
    expect(await healthConnectReader.readHealth(7)).toBeNull();
  });
});
```

`apps/mobile/src/health/healthConnect.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lib = {
  getSdkStatus: vi.fn<() => Promise<number>>(),
  initialize: vi.fn<() => Promise<boolean>>(),
  requestPermission: vi.fn<(permissions: unknown[]) => Promise<unknown[]>>(),
  getGrantedPermissions: vi.fn<() => Promise<{ accessType: string; recordType: string }[]>>(),
  aggregateRecord:
    vi.fn<
      (request: {
        recordType: string;
        timeRangeFilter: { startTime: string; endTime: string };
      }) => Promise<Record<string, unknown>>
    >(),
  readRecords:
    vi.fn<
      (
        recordType: string,
        options: { timeRangeFilter: { startTime: string; endTime: string } },
      ) => Promise<{ records: Record<string, unknown>[] }>
    >(),
};

vi.mock('react-native-health-connect', () => lib);

const { healthConnectReader } = await import('./healthConnect.js');

/** An ISO instant at a local wall-clock time in July 2026. */
const at = (dayOfMonth: number, hour: number, minute = 0): string =>
  new Date(2026, 6, dayOfMonth, hour, minute).toISOString();

const TODAY_START = new Date(2026, 6, 12).toISOString();
const NO_DATA = { dataOrigins: [] as string[] };

const read = (recordType: string) => ({ accessType: 'read', recordType });

beforeEach(() => {
  // Local 3 PM on Sunday 12 July 2026, whatever zone the tests run in.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 6, 12, 15, 0));

  for (const fn of Object.values(lib)) fn.mockReset();
  lib.getSdkStatus.mockResolvedValue(3);
  lib.initialize.mockResolvedValue(true);
  lib.requestPermission.mockResolvedValue([]);
  lib.getGrantedPermissions.mockResolvedValue([]);
  lib.aggregateRecord.mockResolvedValue({
    COUNT_TOTAL: 0,
    BPM_AVG: 0,
    ACTIVE_CALORIES_TOTAL: { inKilocalories: 0 },
    EXERCISE_DURATION_TOTAL: { inSeconds: 0 },
    ...NO_DATA,
  });
  lib.readRecords.mockResolvedValue({ records: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isAvailable', () => {
  it('is true when Health Connect is present and initialises', async () => {
    expect(await healthConnectReader.isAvailable()).toBe(true);
  });

  it.each([1, 2])('is false for SDK status %i', async (status) => {
    lib.getSdkStatus.mockResolvedValue(status);
    expect(await healthConnectReader.isAvailable()).toBe(false);
    expect(lib.initialize).not.toHaveBeenCalled();
  });

  it('is false when the status check itself throws', async () => {
    lib.getSdkStatus.mockRejectedValue(new Error('boom'));
    expect(await healthConnectReader.isAvailable()).toBe(false);
  });
});

describe('connect', () => {
  it('asks for the seven read types and background access, and nothing that writes', async () => {
    lib.getGrantedPermissions.mockResolvedValue([read('Steps')]);

    expect(await healthConnectReader.connect()).toBe('connected');

    const requested = lib.requestPermission.mock.calls[0]![0] as {
      accessType: string;
      recordType: string;
    }[];
    expect(requested.map((p) => p.recordType).sort()).toEqual(
      [
        'ActiveCaloriesBurned',
        'BackgroundAccessPermission',
        'ExerciseSession',
        'Height',
        'RestingHeartRate',
        'SleepSession',
        'Steps',
        'Weight',
      ].sort(),
    );
    expect(requested.every((p) => p.accessType === 'read')).toBe(true);
  });

  it('says so when Health Connect needs installing or updating, without showing a sheet', async () => {
    lib.getSdkStatus.mockResolvedValue(2);
    expect(await healthConnectReader.connect()).toBe('update_required');
    expect(lib.requestPermission).not.toHaveBeenCalled();
  });

  it('is unavailable when there is no Health Connect at all', async () => {
    lib.getSdkStatus.mockResolvedValue(1);
    expect(await healthConnectReader.connect()).toBe('unavailable');
  });

  it('is unavailable when Health Connect will not initialise', async () => {
    lib.initialize.mockResolvedValue(false);
    expect(await healthConnectReader.connect()).toBe('unavailable');
    expect(lib.requestPermission).not.toHaveBeenCalled();
  });

  it('still connects on a phone whose Health Connect has no background-access permission', async () => {
    // An older Health Connect rejects the whole request because of the one permission it
    // has never heard of. That must not cost the user the connection.
    lib.requestPermission
      .mockRejectedValueOnce(new Error('Unknown permission'))
      .mockResolvedValueOnce([]);
    lib.getGrantedPermissions.mockResolvedValue([read('Steps'), read('SleepSession')]);

    expect(await healthConnectReader.connect()).toBe('connected');

    expect(lib.requestPermission).toHaveBeenCalledTimes(2);
    const second = lib.requestPermission.mock.calls[1]![0] as { recordType: string }[];
    expect(second.map((p) => p.recordType)).not.toContain('BackgroundAccessPermission');
    expect(second).toHaveLength(7);
  });

  it('decides from what Health Connect says is granted, not from the request', async () => {
    lib.requestPermission.mockResolvedValue([read('Steps')]);
    lib.getGrantedPermissions.mockResolvedValue([]);
    expect(await healthConnectReader.connect()).toBe('unauthorized');
  });

  it('is not connected when only background access was granted', async () => {
    lib.getGrantedPermissions.mockResolvedValue([read('BackgroundAccessPermission')]);
    expect(await healthConnectReader.connect()).toBe('unauthorized');
  });

  it('never throws, whatever the library does', async () => {
    lib.requestPermission.mockRejectedValue(new Error('activity gone'));
    await expect(healthConnectReader.connect()).resolves.toBe('unauthorized');
  });
});

describe('readHealth', () => {
  it('returns one snapshot per local day, newest first', async () => {
    const result = await healthConnectReader.readHealth(7);

    expect(result!.days.map((d) => d.localDate)).toEqual([
      '2026-07-12',
      '2026-07-11',
      '2026-07-10',
      '2026-07-09',
      '2026-07-08',
      '2026-07-07',
      '2026-07-06',
    ]);
  });

  it('is null when Health Connect is not available', async () => {
    lib.getSdkStatus.mockResolvedValue(1);
    expect(await healthConnectReader.readHealth(7)).toBeNull();
    expect(lib.aggregateRecord).not.toHaveBeenCalled();
  });

  it('reads a day of real data into the shared shape', async () => {
    lib.aggregateRecord.mockImplementation(async ({ recordType, timeRangeFilter }) => {
      const wholeDay = timeRangeFilter.startTime === TODAY_START;
      if (recordType === 'Steps' && wholeDay) {
        return { COUNT_TOTAL: 4321, dataOrigins: ['android'] };
      }
      if (recordType === 'ActiveCaloriesBurned' && wholeDay) {
        return { ACTIVE_CALORIES_TOTAL: { inKilocalories: 412.2 }, dataOrigins: ['com.fitbit'] };
      }
      if (recordType === 'ExerciseSession' && wholeDay) {
        return { EXERCISE_DURATION_TOTAL: { inSeconds: 1800 }, dataOrigins: ['com.fitbit'] };
      }
      if (recordType === 'RestingHeartRate' && wholeDay) {
        return { BPM_AVG: 57, dataOrigins: ['com.fitbit'] };
      }
      // The energy burned during the one workout, asked for over the session's own span.
      if (recordType === 'ActiveCaloriesBurned' && timeRangeFilter.startTime === at(12, 7)) {
        return { ACTIVE_CALORIES_TOTAL: { inKilocalories: 300.4 }, dataOrigins: ['com.fitbit'] };
      }
      return {
        COUNT_TOTAL: 0,
        BPM_AVG: 0,
        ACTIVE_CALORIES_TOTAL: { inKilocalories: 0 },
        EXERCISE_DURATION_TOTAL: { inSeconds: 0 },
        ...NO_DATA,
      };
    });
    lib.readRecords.mockImplementation(async (recordType, { timeRangeFilter }) => {
      if (recordType === 'ExerciseSession' && timeRangeFilter.startTime === TODAY_START) {
        return { records: [{ startTime: at(12, 7), endTime: at(12, 7, 30), exerciseType: 56 }] };
      }
      if (recordType === 'SleepSession') {
        return { records: [{ startTime: at(11, 23), endTime: at(12, 7) }] };
      }
      if (recordType === 'Height') return { records: [{ height: { inMeters: 1.75 } }] };
      if (recordType === 'Weight') return { records: [{ weight: { inKilograms: 70.26 } }] };
      return { records: [] };
    });

    const result = await healthConnectReader.readHealth(7);

    expect(result!.days[0]).toEqual({
      localDate: '2026-07-12',
      steps: 4321,
      activeEnergyKcal: 412,
      exerciseMinutes: 30,
      sleepMinutes: 480,
      sleepStart: new Date(at(11, 23)),
      sleepEnd: new Date(at(12, 7)),
      restingHeartRate: 57,
      workouts: [{ kind: 'running', minutes: 30, energyKcal: 300 }],
    });
    expect(result!.body).toEqual({ heightCm: 175, weightKg: 70.3 });
  });

  it('reports a day nobody recorded as no data, not as zeros', async () => {
    const result = await healthConnectReader.readHealth(2);

    for (const day of result!.days) {
      expect(day.steps).toBeNull();
      expect(day.activeEnergyKcal).toBeNull();
      expect(day.exerciseMinutes).toBeNull();
      expect(day.restingHeartRate).toBeNull();
      expect(day.sleepMinutes).toBeNull();
      expect(day.workouts).toEqual([]);
    }
    expect(result!.body).toEqual({});
  });

  it('leaves a refused type empty and still reads the rest', async () => {
    lib.aggregateRecord.mockImplementation(async ({ recordType }) => {
      if (recordType === 'RestingHeartRate') throw new Error('PERMISSION_ERROR');
      if (recordType === 'Steps') return { COUNT_TOTAL: 4321, dataOrigins: ['android'] };
      return { ...NO_DATA };
    });

    const [today] = (await healthConnectReader.readHealth(1))!.days;

    expect(today!.restingHeartRate).toBeNull();
    expect(today!.steps).toBe(4321);
  });

  it('comes back empty, without throwing, when every read is refused', async () => {
    // A background run without background access: Health Connect refuses everything.
    lib.aggregateRecord.mockRejectedValue(new Error('PERMISSION_ERROR'));
    lib.readRecords.mockRejectedValue(new Error('PERMISSION_ERROR'));

    const result = await healthConnectReader.readHealth(1);

    expect(result!.days[0]!.steps).toBeNull();
    expect(result!.days[0]!.workouts).toEqual([]);
    expect(result!.body).toEqual({});
  });

  it('asks for the latest height and weight only', async () => {
    await healthConnectReader.readHealth(1);

    const heightCall = lib.readRecords.mock.calls.find(([type]) => type === 'Height')!;
    expect(heightCall[1]).toMatchObject({ ascendingOrder: false, pageSize: 1 });
  });
});
```

- [ ] **Step 4: Run them and watch them fail**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/health/healthConnect.test.ts src/health/healthConnect.unlinked.test.ts`
Expected: FAIL — cannot load `./healthConnect.js`.

- [ ] **Step 5: Implement**

`apps/mobile/src/health/healthConnect.ts`:

```ts
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
```

If `tsc` rejects a field access (`records[0]?.height.inMeters`, an aggregate key) the installed version's types differ from the 4.1.3 source this plan was written against: read `node_modules/react-native-health-connect/src/types/` and use the field the types name. Do not cast to `any`.

- [ ] **Step 6: Run them and watch them pass**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/health`
Expected: PASS, all health test files.

Then run the two reader files twenty times; both rely on a dynamic import of a mocked module, which has been flaky in this package before when imports overlapped:

```bash
for i in $(seq 1 20); do pnpm --filter @synitheia/mobile exec vitest run src/health/healthConnect >/dev/null 2>&1 || echo "FAILED on run $i"; done
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
pnpm check
git add apps/mobile/package.json pnpm-lock.yaml apps/mobile/src/health
git commit -m "feat(mobile): Health Connect reader for Android"
```

---

### Task 6: One health module for the whole app

**Files:**
- Create: `apps/mobile/src/health/healthStore.ts`
- Test: `apps/mobile/src/health/healthStore.test.ts`
- Modify: `apps/mobile/src/health/healthkit.ts`, `apps/mobile/src/health/useHealthSync.ts`
- Modify: `apps/mobile/src/sync/runHealthSync.ts`, `apps/mobile/src/sync/runHealthSync.test.ts`
- Modify: `apps/mobile/app/privacy.tsx`, `apps/mobile/app/body.tsx`, `apps/mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `healthConnectReader` (Task 5), `HealthReader`, `HealthConnectResult` (Task 4)
- Produces, from `healthStore.ts`: `isSupported(): boolean`, `healthSourceName(): string`, `isAvailable(): Promise<boolean>`, `connectHealth(): Promise<HealthConnectResult>`, `readHealth(days?: number): Promise<SyncHealthInput | null>`, and a re-export of `type HealthConnectResult`
- Produces, from `healthkit.ts`: `healthkitReader: HealthReader` (its other exports go away)

- [ ] **Step 1: Write the failing store test**

`apps/mobile/src/health/healthStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' as string }));

const ios = {
  isAvailable: vi.fn<() => Promise<boolean>>(),
  connect: vi.fn<() => Promise<string>>(),
  readHealth: vi.fn<(days: number) => Promise<unknown>>(),
};
const android = {
  isAvailable: vi.fn<() => Promise<boolean>>(),
  connect: vi.fn<() => Promise<string>>(),
  readHealth: vi.fn<(days: number) => Promise<unknown>>(),
};

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('./healthkit.js', () => ({ healthkitReader: ios }));
vi.mock('./healthConnect.js', () => ({ healthConnectReader: android }));

const store = await import('./healthStore.js');

beforeEach(() => {
  for (const reader of [ios, android]) {
    reader.isAvailable.mockReset().mockResolvedValue(true);
    reader.connect.mockReset().mockResolvedValue('connected');
    reader.readHealth.mockReset().mockResolvedValue({ days: [] });
  }
});

describe('on iPhone', () => {
  beforeEach(() => {
    platform.OS = 'ios';
  });

  it('uses the HealthKit reader and never touches the Android one', async () => {
    expect(store.isSupported()).toBe(true);
    await store.isAvailable();
    await store.connectHealth();
    await store.readHealth(7);

    expect(ios.isAvailable).toHaveBeenCalledTimes(1);
    expect(ios.connect).toHaveBeenCalledTimes(1);
    expect(ios.readHealth).toHaveBeenCalledWith(7);
    expect(android.isAvailable).not.toHaveBeenCalled();
    expect(android.connect).not.toHaveBeenCalled();
    expect(android.readHealth).not.toHaveBeenCalled();
  });

  it('calls the store Apple Health', () => {
    expect(store.healthSourceName()).toBe('Apple Health');
  });
});

describe('on Android', () => {
  beforeEach(() => {
    platform.OS = 'android';
  });

  it('uses the Health Connect reader and never touches the iPhone one', async () => {
    expect(store.isSupported()).toBe(true);
    await store.isAvailable();
    await store.connectHealth();
    await store.readHealth(7);

    expect(android.isAvailable).toHaveBeenCalledTimes(1);
    expect(android.connect).toHaveBeenCalledTimes(1);
    expect(android.readHealth).toHaveBeenCalledWith(7);
    expect(ios.connect).not.toHaveBeenCalled();
    expect(ios.readHealth).not.toHaveBeenCalled();
  });

  it('calls the store Health Connect', () => {
    expect(store.healthSourceName()).toBe('Health Connect');
  });

  it('passes the reader\'s outcome through, including "update required"', async () => {
    android.connect.mockResolvedValue('update_required');
    expect(await store.connectHealth()).toBe('update_required');
  });

  it('reads seven days unless told otherwise', async () => {
    await store.readHealth();
    expect(android.readHealth).toHaveBeenCalledWith(7);
  });
});

describe('anywhere else', () => {
  beforeEach(() => {
    platform.OS = 'web';
  });

  it('has no health store, and says so without calling a reader', async () => {
    expect(store.isSupported()).toBe(false);
    expect(await store.isAvailable()).toBe(false);
    expect(await store.connectHealth()).toBe('unavailable');
    expect(await store.readHealth(7)).toBeNull();
    expect(store.healthSourceName()).toBe('your health app');

    expect(ios.readHealth).not.toHaveBeenCalled();
    expect(android.readHealth).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Point the sync runner's test at the store, and add the partial-grant cases**

In `apps/mobile/src/sync/runHealthSync.test.ts`, replace

```ts
vi.mock('../health/healthkit.js', () => ({ isSupported, readHealth }));
```

with

```ts
vi.mock('../health/healthStore.js', () => ({ isSupported, readHealth }));
```

and add these tests inside the existing `describe('runHealthSync', …)` block, after the test named `'still posts when only body metrics came back'`:

```ts
  it('syncs a day that has only a workout — a partial grant is still a connection', async () => {
    // On Android the user can allow workouts and nothing else. Steps, energy and sleep
    // are then null every day, and the old "nothing to send" test would never sync.
    readHealth.mockResolvedValue({
      days: [day({ steps: null, workouts: [{ kind: 'running', minutes: 30, energyKcal: null }] })],
    });
    post.mockResolvedValue({ days: 1, stepsApplied: 0 });

    expect((await runHealthSync()).skipped).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['exercise minutes', { exerciseMinutes: 30 }],
    ['a resting heart rate', { restingHeartRate: 57 }],
  ])('syncs a day that has only %s', async (_label, fields) => {
    readHealth.mockResolvedValue({ days: [day({ steps: null, ...fields })] });
    post.mockResolvedValue({ days: 1, stepsApplied: 0 });

    expect((await runHealthSync()).skipped).toBe(false);
  });
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/health/healthStore.test.ts src/sync/runHealthSync.test.ts`
Expected: FAIL — `./healthStore.js` cannot be loaded; and `runHealthSync.test.ts` fails because `runHealthSync.ts` still imports `healthkit.js`, which the test no longer mocks.

- [ ] **Step 4: Make the iPhone reader a `HealthReader`**

In `apps/mobile/src/health/healthkit.ts`:

1. Delete `import { Platform } from 'react-native';`.
2. Add after the `./dayBounds.js` import:

```ts
import type { HealthConnectResult, HealthReader } from './types.js';
```

3. In the header comment, replace the paragraph that begins `iOS only. Android's equivalent is Health Connect` (four lines, ending `Nothing on the server changes.`) with:

```ts
 * iOS only. Android's counterpart is healthConnect.ts; both produce the same normalized
 * `SyncHealthInput`, the server knows nothing about either, and the rest of the app
 * reaches whichever one applies through healthStore.ts.
```

4. Delete the `isSupported` function, and delete `healthSourceName` together with its doc comment. Both move to the store.
5. Replace the `isAvailable` function with (no `export`, no platform check — the store only calls this on iPhone):

```ts
async function isAvailable(): Promise<boolean> {
  try {
    return await isHealthDataAvailableAsync();
  } catch {
    return false;
  }
}
```

6. Remove the `export` keyword from `requestPermissions` and from `readHealth`. Change `readHealth`'s signature from `(days = 7)` to `(days: number)`.
7. Append to the end of the file:

```ts

/**
 * Two grants, in order: iOS's, then ours. Asking iOS first means a user who declines the
 * system sheet never gets a "connected" row promising data we cannot read.
 */
async function connect(): Promise<HealthConnectResult> {
  if (!(await isAvailable())) return 'unavailable';
  return (await requestPermissions()) ? 'connected' : 'unauthorized';
}

export const healthkitReader: HealthReader = { isAvailable, connect, readHealth };
```

- [ ] **Step 5: Create the store**

`apps/mobile/src/health/healthStore.ts`:

```ts
import { Platform } from 'react-native';
import type { SyncHealthInput } from '@synitheia/shared';
import { healthConnectReader } from './healthConnect.js';
import { healthkitReader } from './healthkit.js';
import type { HealthConnectResult, HealthReader } from './types.js';

export type { HealthConnectResult } from './types.js';

/**
 * The phone's health store, whichever phone this is.
 *
 * The only health module the rest of the app imports. Apple Health and Health Connect are
 * different native libraries with different permission models, and none of that is the
 * business of a sync runner or a settings screen: they ask for "the last seven days" and
 * get the same shape back on both.
 *
 * Importing both readers here is safe on both platforms. healthkit.ts imports a library
 * that is inert on Android, and healthConnect.ts imports nothing native until it is called.
 */
function reader(): HealthReader | null {
  if (Platform.OS === 'ios') return healthkitReader;
  if (Platform.OS === 'android') return healthConnectReader;
  return null;
}

export function isSupported(): boolean {
  return reader() !== null;
}

/**
 * What the user's phone actually calls its health store.
 *
 * The UI must never hardcode "Apple Health". An Android user told to "add it in the Health
 * app" would be sent looking for something that does not exist on their phone. Naming the
 * source is a platform question, so it gets answered in exactly one place.
 */
export function healthSourceName(): string {
  if (Platform.OS === 'ios') return 'Apple Health';
  if (Platform.OS === 'android') return 'Health Connect';
  return 'your health app';
}

export async function isAvailable(): Promise<boolean> {
  return (await reader()?.isAvailable()) ?? false;
}

/**
 * Turning the Health source on: the OS's grant first, ours second, so a user who declines
 * the system sheet never gets a "connected" row promising data we cannot read.
 */
export async function connectHealth(): Promise<HealthConnectResult> {
  return (await reader()?.connect()) ?? 'unavailable';
}

export async function readHealth(days = 7): Promise<SyncHealthInput | null> {
  return (await reader()?.readHealth(days)) ?? null;
}
```

- [ ] **Step 6: Switch every importer to the store**

`apps/mobile/src/health/useHealthSync.ts`:
- Delete the line `import { isAvailable, isSupported, requestPermissions } from './healthkit.js';`.
- Change the first line of the file's header comment from `Keep Apple Health and Synítheia in step.` to `Keep the phone's health store and Synítheia in step.`
- Delete everything from the comment that begins `/**\n * Turning the Health source on.` to the end of the file: both doc comments, the `HealthConnectResult` type and the `connectHealth` function. They now live in `types.ts` and `healthStore.ts`.

`apps/mobile/src/sync/runHealthSync.ts`:
- Change the import to `import { isSupported, readHealth } from '../health/healthStore.js';`.
- Change the doc comment's first line from `One Apple Health sync.` to `One health sync, from whichever store this phone has.`
- Replace the `hasAnything` block and its comment with:

```ts
    const hasAnything =
      payload.days.some(
        (d) =>
          d.steps != null ||
          d.activeEnergyKcal != null ||
          d.exerciseMinutes != null ||
          d.sleepMinutes != null ||
          d.restingHeartRate != null ||
          d.workouts.length > 0,
      ) || Object.keys(payload.body ?? {}).length > 0;

    // Neither platform reliably says "you may not read this". iOS never reports a denied
    // read, and returns nothing while the phone is locked; Health Connect refuses every
    // read from the background unless background access was granted. Posting an empty
    // week would blank out real data with nulls, so an empty read is a no-op.
    //
    // Every field counts, not just steps: on Android a user can grant workouts alone, and
    // a test that only looked at steps, energy and sleep would never sync them.
    if (!hasAnything) return SKIPPED;
```

`apps/mobile/app/privacy.tsx`: replace the two lines

```ts
import { healthSourceName } from '../src/health/healthkit.js';
import { connectHealth, useHealthSync } from '../src/health/useHealthSync.js';
```

with

```ts
import { connectHealth, healthSourceName } from '../src/health/healthStore.js';
import { useHealthSync } from '../src/health/useHealthSync.js';
```

`apps/mobile/app/body.tsx`: change `'../src/health/healthkit.js'` to `'../src/health/healthStore.js'` in the `healthSourceName` import.

`apps/mobile/app/(tabs)/index.tsx`: in the comment above the `data-sources` query, change `Apple Health, pulled on every foreground.` to `The phone's health store, pulled on every foreground.`

- [ ] **Step 7: Run and check nothing still imports the old entry points**

```bash
pnpm --filter @synitheia/mobile exec vitest run src/health src/sync
grep -rn "health/healthkit\|from './healthkit" apps/mobile/app apps/mobile/src | grep -v "healthStore.ts\|healthStore.test.ts"
pnpm --filter @synitheia/mobile exec tsc --noEmit
```

Expected: tests PASS; the grep prints nothing (only the store and its test may name `healthkit.js`); `tsc` is clean. A `tsc` error in `privacy.tsx` about `'update_required'` not being handled is expected to be absent here, because the existing code only compares against `'unavailable'` and `'unauthorized'`; Task 8 adds the new branch.

- [ ] **Step 8: Commit**

```bash
pnpm check
git add apps/mobile/src/health apps/mobile/src/sync apps/mobile/app
git commit -m "feat(mobile): one health module for both platforms; partial grants still sync"
```

---

### Task 7: Manifest entries, the policy-link trampoline, and build settings

**Files:**
- Create: `apps/mobile/plugins/withHealthConnectRationale.js`
- Test: `apps/mobile/plugins/withHealthConnectRationale.test.ts`
- Test: `apps/mobile/src/health/manifestPermissions.test.ts`
- Modify: `apps/mobile/app.json`

**Interfaces:**
- Consumes: `READ_RECORD_TYPES`, `MANIFEST_PERMISSIONS`, `BACKGROUND_PERMISSION` (Task 4)
- Produces: the config plugin (default export), with `applyRationale(androidManifest)` and `rationaleActivitySource(packageName, deepLink)` attached for tests

- [ ] **Step 1: Write the failing tests**

`apps/mobile/plugins/withHealthConnectRationale.test.ts`:

```ts
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface ManifestNode {
  $: Record<string, string>;
  'intent-filter'?: {
    action?: { $: Record<string, string> }[];
    category?: { $: Record<string, string> }[];
  }[];
}

interface Manifest {
  manifest: {
    $: Record<string, string>;
    application: (ManifestNode & {
      activity?: ManifestNode[];
      'activity-alias'?: ManifestNode[];
    })[];
  };
}

// The plugin is CommonJS, because Expo loads config plugins with plain `require`. Loaded
// here the same way, so the test exercises the file exactly as prebuild will.
const plugin = createRequire(import.meta.url)('./withHealthConnectRationale.js') as {
  applyRationale: (manifest: Manifest) => Manifest;
  rationaleActivitySource: (packageName: string, deepLink: string) => string;
};

function manifest(): Manifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            {
              $: { 'android:name': '.MainActivity', 'android:exported': 'true' },
              'intent-filter': [
                { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }] },
              ],
            },
          ],
        },
      ],
    },
  };
}

const app = (m: Manifest) => m.manifest.application[0]!;
const named = (nodes: ManifestNode[] | undefined, name: string) =>
  (nodes ?? []).filter((n) => n.$['android:name'] === name);
const actions = (node: ManifestNode) =>
  (node['intent-filter'] ?? []).flatMap((f) => (f.action ?? []).map((a) => a.$['android:name']));
const categories = (node: ManifestNode) =>
  (node['intent-filter'] ?? []).flatMap((f) => (f.category ?? []).map((c) => c.$['android:name']));

describe('applyRationale', () => {
  it('declares the trampoline activity for the Android 13-and-earlier intent', () => {
    const result = plugin.applyRationale(manifest());
    const [activity] = named(app(result).activity, '.HealthRationaleActivity');

    expect(activity).toBeDefined();
    // Health Connect is another app: it can only start an exported activity.
    expect(activity!.$['android:exported']).toBe('true');
    expect(actions(activity!)).toEqual(['androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE']);
  });

  it('declares the Android 14+ alias, pointing at the trampoline and guarded by the system permission', () => {
    const result = plugin.applyRationale(manifest());
    const [alias] = named(app(result)['activity-alias'], 'ViewPermissionUsageActivity');

    expect(alias).toBeDefined();
    expect(alias!.$['android:exported']).toBe('true');
    expect(alias!.$['android:targetActivity']).toBe('.HealthRationaleActivity');
    expect(alias!.$['android:permission']).toBe('android.permission.START_VIEW_PERMISSION_USAGE');
    expect(actions(alias!)).toEqual(['android.intent.action.VIEW_PERMISSION_USAGE']);
    expect(categories(alias!)).toEqual(['android.intent.category.HEALTH_PERMISSIONS']);
  });

  it("leaves the main activity's own intent filters alone", () => {
    const result = plugin.applyRationale(manifest());
    const [main] = named(app(result).activity, '.MainActivity');

    // If the rationale intent landed on MainActivity the link would open the app on Today.
    expect(actions(main!)).toEqual(['android.intent.action.MAIN']);
  });

  it('is idempotent — prebuild runs more than once', () => {
    const result = plugin.applyRationale(plugin.applyRationale(manifest()));

    expect(named(app(result).activity, '.HealthRationaleActivity')).toHaveLength(1);
    expect(named(app(result)['activity-alias'], 'ViewPermissionUsageActivity')).toHaveLength(1);
    expect(app(result).activity).toHaveLength(2);
  });

  it('declares the alias after the activity it targets', () => {
    // Android requires an activity-alias to follow its target in the manifest. The XML is
    // written in key order, so `activity` has to come before `activity-alias`.
    const keys = Object.keys(app(plugin.applyRationale(manifest())));
    expect(keys.indexOf('activity')).toBeLessThan(keys.indexOf('activity-alias'));
  });
});

describe('rationaleActivitySource', () => {
  const source = plugin.rationaleActivitySource('com.synitheia.app', 'synitheia://privacy');

  it('is a Kotlin activity in the app package', () => {
    expect(source).toContain('package com.synitheia.app');
    expect(source).toContain('class HealthRationaleActivity : Activity()');
  });

  it('re-launches the app at the deep link, inside this app only, and gets out of the way', () => {
    expect(source).toContain('Uri.parse("synitheia://privacy")');
    expect(source).toContain('setPackage(packageName)');
    expect(source).toContain('finish()');
  });
});
```

`apps/mobile/src/health/manifestPermissions.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_PERMISSION,
  MANIFEST_PERMISSIONS,
  READ_RECORD_TYPES,
} from './healthConnectNormalize.js';

interface AppJson {
  expo: {
    android: { permissions: string[] };
    plugins: (string | [string, Record<string, unknown>])[];
  };
}

const { expo } = JSON.parse(
  readFileSync(new URL('../../app.json', import.meta.url), 'utf8'),
) as AppJson;

const health = expo.android.permissions.filter((p) => p.startsWith('android.permission.health.'));
const pluginNames = expo.plugins.map((p) => (typeof p === 'string' ? p : p[0]));

describe('app.json and Health Connect', () => {
  it('declares a manifest permission for every type the app asks for at runtime', () => {
    // Health Connect refuses a request for a permission the manifest does not declare,
    // and the failure only shows on a phone. This is the cheap place to catch it.
    for (const type of READ_RECORD_TYPES) {
      expect(health).toContain(MANIFEST_PERMISSIONS[type]);
    }
    expect(health).toContain(BACKGROUND_PERMISSION);
  });

  it('declares nothing else — no extra type, and nothing that writes', () => {
    expect(health).toHaveLength(READ_RECORD_TYPES.length + 1);
    expect(health.filter((p) => p.includes('.WRITE_'))).toEqual([]);
  });

  it('raises the minimum Android version to the one Health Connect needs', () => {
    const buildProperties = expo.plugins.find(
      (p): p is [string, Record<string, unknown>] =>
        Array.isArray(p) && p[0] === 'expo-build-properties',
    );
    expect(buildProperties?.[1]).toMatchObject({ android: { minSdkVersion: 26 } });
  });

  it("uses our rationale plugin and not the library's", () => {
    expect(pluginNames).toContain('./plugins/withHealthConnectRationale');
    // The library's own plugin points Health Connect's policy link at MainActivity.
    expect(pluginNames).not.toContain('react-native-health-connect');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @synitheia/mobile exec vitest run plugins src/health/manifestPermissions.test.ts`
Expected: FAIL — the plugin file does not exist, and `app.json` has no health permissions.

- [ ] **Step 3: Write the plugin**

`apps/mobile/plugins/withHealthConnectRationale.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

/**
 * Health Connect's "privacy policy" link, wired to Connected Context.
 *
 * Health Connect shows a link on its permission screen that the app must be able to
 * answer. Android delivers the tap as an intent with an action and NO url — something
 * React Native never sees — so pointing it at MainActivity (which is what the
 * react-native-health-connect plugin does) just opens the app wherever it last was.
 *
 * This plugin is used INSTEAD of that one. It writes a tiny native activity that receives
 * the intent and re-launches the app at a deep link, and it declares that activity for
 * both forms of the intent: the action Health Connect uses through Android 13, and the
 * activity-alias Android 14+ requires. Doing all of it here, rather than patching the
 * other plugin's output, keeps this independent of the order plugins run in.
 */

const ACTIVITY = 'HealthRationaleActivity';
const ALIAS = 'ViewPermissionUsageActivity';
const RATIONALE_ACTION = 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE';

function rationaleActivitySource(packageName, deepLink) {
  return `package ${packageName}

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * GENERATED by plugins/withHealthConnectRationale.js. Edit the plugin, not this file.
 *
 * Health Connect starts this when the user taps its "privacy policy" link. The intent
 * carries no url, so React Native cannot route it; this re-launches the app at the deep
 * link for the screen that explains what the app reads and why, then gets out of the way.
 */
class ${ACTIVITY} : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    startActivity(
      Intent(Intent.ACTION_VIEW, Uri.parse("${deepLink}"))
        // This app only: the link must never be answered by another app that happens to
        // claim the same scheme.
        .setPackage(packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    )
    finish()
  }
}
`;
}

/** Adds the activity and the alias to a parsed AndroidManifest. Safe to apply twice. */
function applyRationale(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

  application.activity = (application.activity ?? []).filter(
    (activity) => activity.$['android:name'] !== `.${ACTIVITY}`,
  );
  application.activity.push({
    $: {
      'android:name': `.${ACTIVITY}`,
      // Health Connect is another app; it can only start an exported activity.
      'android:exported': 'true',
      'android:theme': '@android:style/Theme.Translucent.NoTitleBar',
      'android:excludeFromRecents': 'true',
      'android:noHistory': 'true',
    },
    'intent-filter': [{ action: [{ $: { 'android:name': RATIONALE_ACTION } }] }],
  });

  // Re-created last so that, in the written XML, the alias follows the activity it
  // targets. Android rejects an alias declared before its target.
  const aliases = (application['activity-alias'] ?? []).filter(
    (alias) => alias.$['android:name'] !== ALIAS,
  );
  delete application['activity-alias'];
  application['activity-alias'] = [
    ...aliases,
    {
      $: {
        'android:name': ALIAS,
        'android:exported': 'true',
        'android:targetActivity': `.${ACTIVITY}`,
        'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
          category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }],
        },
      ],
    },
  ];

  return androidManifest;
}

const withHealthConnectRationale = (config, props = {}) => {
  const deepLink = props.deepLink ?? 'synitheia://privacy';

  config = withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = applyRationale(manifestConfig.modResults);
    return manifestConfig;
  });

  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const packageName = modConfig.android?.package;
      if (!packageName) {
        throw new Error('withHealthConnectRationale: expo.android.package must be set');
      }

      const directory = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app/src/main/java',
        ...packageName.split('.'),
      );
      await fs.promises.mkdir(directory, { recursive: true });
      await fs.promises.writeFile(
        path.join(directory, `${ACTIVITY}.kt`),
        rationaleActivitySource(packageName, deepLink),
      );

      return modConfig;
    },
  ]);
};

module.exports = createRunOncePlugin(withHealthConnectRationale, 'with-health-connect-rationale', '1.0.0');
module.exports.applyRationale = applyRationale;
module.exports.rationaleActivitySource = rationaleActivitySource;
```

- [ ] **Step 4: Edit `app.json`**

In `apps/mobile/app.json`, in `expo.android.permissions`, add these eight entries after `"android.permission.READ_CONTACTS"` (add a comma after that line):

```json
        "android.permission.health.READ_STEPS",
        "android.permission.health.READ_EXERCISE",
        "android.permission.health.READ_SLEEP",
        "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
        "android.permission.health.READ_RESTING_HEART_RATE",
        "android.permission.health.READ_WEIGHT",
        "android.permission.health.READ_HEIGHT",
        "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"
```

In `expo.plugins`, replace the final entry `"expo-background-task"` with:

```json
      "expo-background-task",
      [
        "expo-build-properties",
        {
          "android": {
            "minSdkVersion": 26
          }
        }
      ],
      "./plugins/withHealthConnectRationale"
```

Confirm the file is still valid JSON and that `react-native-health-connect` is not in `plugins`:

```bash
python3 -c "import json; d=json.load(open('apps/mobile/app.json'))['expo']; print([p if isinstance(p,str) else p[0] for p in d['plugins']][-3:]); print(len([p for p in d['android']['permissions'] if '.health.' in p]))"
```

Expected: `['expo-background-task', 'expo-build-properties', './plugins/withHealthConnectRationale']` and `8`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --filter @synitheia/mobile exec vitest run plugins src/health/manifestPermissions.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove the plugin works inside a real prebuild**

The unit test exercises the plugin's functions; this exercises Expo actually running it. It generates the native Android project locally (it is git-ignored) and does not compile anything.

```bash
cd apps/mobile && npx expo prebuild --platform android --no-install --clean && cd ../..
M=apps/mobile/android/app/src/main/AndroidManifest.xml
grep -c "android.permission.health\." "$M"
grep -n "HealthRationaleActivity\|ViewPermissionUsageActivity\|ACTION_SHOW_PERMISSIONS_RATIONALE\|VIEW_PERMISSION_USAGE\|HEALTH_PERMISSIONS" "$M"
cat apps/mobile/android/app/src/main/java/com/synitheia/app/HealthRationaleActivity.kt | head -12
grep -rn "minSdkVersion" apps/mobile/android/gradle.properties apps/mobile/android/build.gradle | head
git status --short | head
```

Expected:
- `8` health permissions.
- The activity, the alias and both intent actions appear, and in the file the `<activity-alias>` line comes after the `HealthRationaleActivity` `<activity>` line.
- The Kotlin file exists and starts with `package com.synitheia.app`.
- `android.minSdkVersion=26` (in `gradle.properties`).
- `git status` shows no `android/` files (the directory is ignored). If prebuild rewrote
  `apps/mobile/package.json` (it sometimes adjusts `scripts`), undo that with
  `git checkout apps/mobile/package.json`; CI runs the same prebuild and commits nothing.

If the rationale intent also appears on `.MainActivity`, the library's plugin is being applied: check `plugins` in `app.json` again.

Then remove the generated project so it cannot go stale:

```bash
rm -rf apps/mobile/android
```

- [ ] **Step 7: Commit**

```bash
pnpm check
git add apps/mobile/plugins apps/mobile/app.json apps/mobile/src/health/manifestPermissions.test.ts
git commit -m "feat(mobile): Health Connect permissions, policy-link trampoline, minSdk 26"
```

---

### Task 8: Connected Context on Android

**Files:**
- Modify: `apps/mobile/app/privacy.tsx`

**Interfaces:**
- Consumes: `connectHealth`, `healthSourceName`, `HealthConnectResult` (Task 6)

There is no component test harness in this repo, so this task is verified by `tsc`, lint, and the emulator in Task 10.

- [ ] **Step 1: Add the Play Store helper and the "already shown" error**

In `apps/mobile/app/privacy.tsx`, add `Linking` to the `react-native` import list (keep it alphabetical: after `KeyboardAvoidingView`).

After the line `const SOURCES_KEY = ['data-sources'] as const;` add:

```tsx

/**
 * Ends a mutation whose failure the user has already been shown.
 *
 * The mutation's `onError` puts up a generic "Could not update" alert. When a branch has
 * something better to say — an alert with a way forward — it shows that and throws this,
 * so the generic one does not land on top of it.
 */
class AlreadyExplained extends Error {}

const HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata';

/** Health Connect's Play Store page. The `market:` form opens the store app directly. */
async function openHealthConnectInStore(): Promise<void> {
  try {
    await Linking.openURL(
      `market://details?id=${HEALTH_CONNECT_PACKAGE}&url=healthconnect%3A%2F%2Fonboarding`,
    );
  } catch {
    // No Play Store on this phone. The web page at least says what to look for.
    await Linking.openURL(
      `https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PACKAGE}`,
    ).catch(() => undefined);
  }
}
```

- [ ] **Step 2: Handle the two Android outcomes**

In the `updateSource` mutation's `mutationFn`, inside `if (input.source === 'health' && input.status === 'connected') {`, add this branch immediately after the `if (result === 'unavailable') { … }` block:

```tsx
        if (result === 'update_required') {
          // Android 9 to 13, where Health Connect is a separate app that is missing or too
          // old. "Could not update" would leave the user with nowhere to go, so this alert
          // carries the way forward and the mutation ends quietly behind it.
          Alert.alert(
            'Health Connect needed',
            'Health Connect is missing or out of date on this phone. Install or update it from the Play Store, then turn this on again.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Play Store', onPress: () => void openHealthConnectInStore() },
            ],
          );
          throw new AlreadyExplained();
        }
```

In the same block, replace the Android half of the `unauthorized` message. Change

```tsx
              : `Couldn't connect ${healthSourceName()}. Check its permission in Settings and try again.`,
```

to

```tsx
              : `${healthSourceName()} didn't give Synítheia access to anything. Turn this on again and allow at least one kind of data, or change it later in the ${healthSourceName()} app.`,
```

- [ ] **Step 3: Keep the generic alert off an already-explained failure**

In the same mutation, change

```tsx
    onError: (error: unknown) => {
      Alert.alert(
```

to

```tsx
    onError: (error: unknown) => {
      if (error instanceof AlreadyExplained) return;

      Alert.alert(
```

- [ ] **Step 4: Check and commit**

```bash
pnpm check
git add apps/mobile/app/privacy.tsx
git commit -m "feat(mobile): Connected Context handles a missing or outdated Health Connect"
```

Expected: `pnpm check` passes.

---

### Task 9: Both platforms build, and the Android build really contains the feature

**Files:** none changed. This task produces evidence.

This repo has had native modules compile and then be absent from the app. A green build is therefore not accepted as proof: the built APK is opened and checked.

- [ ] **Step 1: Push the branch and build both platforms**

```bash
git push -u origin feature/android-health-connect
gh workflow run android.yml --ref feature/android-health-connect
gh workflow run ios.yml --ref feature/android-health-connect
sleep 10
gh run list --branch feature/android-health-connect --limit 2 --json databaseId,name,status --jq '.[] | "\(.databaseId) \(.name) \(.status)"'
```

Wait for both (iOS about 13 minutes, Android about 25):

```bash
for id in <ios-run-id> <android-run-id>; do
  until [ "$(gh run view $id --json status --jq .status)" = "completed" ]; do sleep 30; done
  gh run view $id --json name,conclusion,jobs --jq '"\(.name): \(.conclusion) — failed steps: " + ([.jobs[].steps[] | select(.conclusion=="failure") | .name] | join(","))'
done
```

Expected: both `success`.

- If Android fails in Gradle with a `minSdkVersion` or manifest-merger error, the build properties plugin did not apply: re-check Task 7 Step 4.
- If iOS fails in `pod install` or codegen naming `RNHealthConnectSpec`, the Android library's codegen config is being picked up for iOS. Stop and treat it as a finding to rule on; do not delete the library's files.
- A failure in the shared `Typecheck and test` step is a test failure: read it with `gh run view <id> --log-failed`.

- [ ] **Step 2: Download the APK and inspect it**

```bash
OUT="$(mktemp -d)"
gh run download <android-run-id> -n Synitheia-apk -D "$OUT"
APK="$OUT/Synitheia.apk"
AAPT="$ANDROID_HOME/build-tools/36.1.0/aapt2"

echo "--- health permissions (expect 8, none with WRITE)"
"$AAPT" dump permissions "$APK" | grep "permission.health" | sort

echo "--- minimum SDK (expect 26)"
"$AAPT" dump badging "$APK" | grep -E "^(sdkVersion|minSdkVersion)"

echo "--- rationale entry points"
"$AAPT" dump xmltree "$APK" --file AndroidManifest.xml | grep -E "HealthRationaleActivity|ViewPermissionUsageActivity|ACTION_SHOW_PERMISSIONS_RATIONALE|VIEW_PERMISSION_USAGE|HEALTH_PERMISSIONS|START_VIEW_PERMISSION_USAGE"

echo "--- classes really in the dex files (each expect >= 1)"
mkdir "$OUT/dex" && unzip -q -o "$APK" 'classes*.dex' -d "$OUT/dex"
for c in "Ldev/matinzd/healthconnect/HealthConnectModule;" "Lexpo/modules/healthconnect/HealthConnectPackage;" "Lcom/synitheia/app/HealthRationaleActivity;" "Landroidx/health/connect/client/HealthConnectClient;"; do
  printf "%-62s %s\n" "$c" "$(cat "$OUT"/dex/classes*.dex | grep -a -c "$c")"
done
echo "APK kept at $APK for Task 10"
```

Expected:
- Exactly the eight `android.permission.health.READ_*` permissions.
- `sdkVersion:'26'`.
- The activity, the alias, both actions, the category and the guarding permission.
- A count of at least 1 for each of the four class names. A `0` for `HealthConnectModule` means the module did not link: stop, and treat it as the known linking problem rather than proceeding to the emulator.

- [ ] **Step 3: Record the result**

No commit. Note the two run ids, the APK path and the inspection output in the ledger.

---

### Task 10: Emulator check

**Files:** none changed in the repo. A helper script lives in the scratch directory.

Time-box: if the emulator cannot be brought to a booted Android 14 home screen with Health Connect present within about 45 minutes of effort, stop, record what was tried as a `Ruling:` in the ledger, and describe Android health as "built, not run on any Android device". Do not report an emulator result that was not observed.

The APK from Task 9 is a release build that talks to the production API, so this creates one throwaway account there. It is deleted through the app's own delete-account flow in Step 8.

- [ ] **Step 1: Install the command-line tools, the emulator and an Android 14 image**

```bash
cd "$(mktemp -d)"
curl -fL -o cmdline.zip https://dl.google.com/android/repository/commandlinetools-mac_arm64-15859902_latest.zip
shasum -a 256 cmdline.zip   # expect 835b62a26162b229b441d1f6d4680383815a270809eb33522c0d480fa5002c4e
mkdir -p "$ANDROID_HOME/cmdline-tools" && unzip -q cmdline.zip -d "$ANDROID_HOME/cmdline-tools" && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
SDK="$ANDROID_HOME/cmdline-tools/latest/bin"
yes | "$SDK/sdkmanager" --licenses >/dev/null
"$SDK/sdkmanager" "emulator" "platform-tools" "system-images;android-34;google_apis;arm64-v8a"
echo no | "$SDK/avdmanager" create avd -n synitheia-hc -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_7 --force
```

If the download 404s or the checksum differs, open https://developer.android.com/studio, take the current Mac (ARM) "Command line tools only" file name and checksum from the table there, and use those.

- [ ] **Step 2: Boot it headless and wait for it**

```bash
"$ANDROID_HOME/emulator/emulator" -avd synitheia-hc -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect > /tmp/synitheia-emulator.log 2>&1 &
ADB="$ANDROID_HOME/platform-tools/adb"
"$ADB" wait-for-device
until [ "$("$ADB" shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 3; done
"$ADB" shell getprop ro.build.version.release
"$ADB" shell pm list packages | grep -i health
```

Expected: `14`, and a Health Connect package (`com.google.android.healthconnect.controller` or `com.android.healthconnect.controller`).

- [ ] **Step 3: Save the helper that drives the screen by its text**

Save as `ui.py` in the scratch directory:

```python
#!/usr/bin/env python3
"""Drive the emulator by what is on screen. A verification aid, not part of the app.

  ui.py texts              list visible text / content descriptions with their bounds
  ui.py has "<text>"       exit 0 if a node's text or description contains <text>
  ui.py tap "<text>"       tap the first node whose text or description contains <text>
  ui.py type "<text>"      type into the focused field
  ui.py key <KEYCODE>      send a key event, e.g. BACK, ENTER
  ui.py shot <file.png>    save a screenshot
  ui.py open "<url>"       open a deep link in com.synitheia.app
"""
import html
import os
import re
import subprocess
import sys

ADB = os.path.join(os.environ["ANDROID_HOME"], "platform-tools", "adb")


def adb(*args, capture=False):
    return subprocess.run([ADB, *args], check=True, capture_output=capture)


def nodes():
    raw = adb("exec-out", "uiautomator", "dump", "/dev/tty", capture=True).stdout.decode("utf-8", "replace")
    for match in re.finditer(r"<node[^>]*>", raw):
        node = match.group(0)
        attr = lambda name: html.unescape((re.search(rf' {name}="([^"]*)"', node) or [None, ""])[1])
        bounds = re.search(r' bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if bounds:
            yield attr("text"), attr("content-desc"), tuple(map(int, bounds.groups()))


def find(want):
    want = want.lower()
    for text, desc, box in nodes():
        if want in text.lower() or want in desc.lower():
            return text or desc, box
    return None


command, *rest = sys.argv[1:]

if command == "texts":
    for text, desc, box in nodes():
        if text or desc:
            print(repr(text or desc), box)
elif command == "has":
    sys.exit(0 if find(rest[0]) else 1)
elif command == "tap":
    hit = find(rest[0])
    if not hit:
        sys.exit(f"NOT FOUND: {rest[0]}")
    label, (x1, y1, x2, y2) = hit
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
    print("tapped", repr(label))
elif command == "type":
    adb("shell", "input", "text", rest[0].replace(" ", "%s"))
elif command == "key":
    adb("shell", "input", "keyevent", f"KEYCODE_{rest[0]}")
elif command == "shot":
    with open(rest[0], "wb") as out:
        out.write(adb("exec-out", "screencap", "-p", capture=True).stdout)
    print(rest[0])
elif command == "open":
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", rest[0], "com.synitheia.app")
else:
    sys.exit(__doc__)
```

Every later step works the same way: run `ui.py texts` (and `ui.py shot`, then look at the image) to see what is on screen, then `ui.py tap` the label that is actually there. Labels on system screens differ between Android versions, so read them rather than assume them.

- [ ] **Step 4: Put sample data into Health Connect**

Download Google's Health Connect Toolbox from https://goo.gle/health-connect-toolbox, unzip it, and install the APK it contains:

```bash
"$ADB" install -r HealthConnectToolbox-*.apk
"$ADB" shell monkey -p androidx.health.connect.client.devtool -c android.intent.category.LAUNCHER 1
```

(If that package name is not the Toolbox's, find it with `"$ADB" shell pm list packages | grep -i -E "toolbox|devtool"`.)

In the Toolbox, grant it Health Connect permissions when it asks, then use **Insert Health Record** to add, for today:

| Record | Value |
|---|---|
| Steps | 4321 |
| Exercise session | Running, 30 minutes, earlier today |
| Sleep session | about 8 hours, ending this morning |
| Weight | 70 kg |
| Height | 1.75 m |

Take a screenshot after each save. If a record type cannot be inserted through the Toolbox on this image, record which, and carry on with the ones that can.

- [ ] **Step 5: Install the app and make a throwaway account**

```bash
"$ADB" install -r "$APK"
"$ADB" shell monkey -p com.synitheia.app -c android.intent.category.LAUNCHER 1
"$ADB" logcat -c
```

Go through onboarding and sign up with name `HC Test`, email `hc-emulator-<unix-timestamp>@example.com` and a random 16-character password, then finish setup. Write the email down: it is needed to delete the account.

Check the log for a linking failure before going further:

```bash
"$ADB" logcat -d | grep -i -E "doesn't seem to be linked|HealthConnect.*(not found|could not)|TurboModuleRegistry" | head
```

Expected: no output.

- [ ] **Step 6: Connect Health and confirm the data arrives**

```bash
python3 ui.py open "synitheia://privacy"
python3 ui.py shot privacy-before.png
python3 ui.py tap "Collect Health"
python3 ui.py shot hc-permissions.png
```

On Health Connect's permission screen, confirm from the screenshot and `ui.py texts`:
- exactly seven data types are listed: steps, exercise, sleep, active calories burned, resting heart rate, weight, height;
- nothing is listed under "write";
- background access is offered (it may be on a second screen, or absent on this image: record which).

Allow all, confirm, and return to the app. Then:

```bash
sleep 8
python3 ui.py shot privacy-after.png
python3 ui.py texts | grep -i -E "health|event|synced"
python3 ui.py open "synitheia://"
sleep 3 && python3 ui.py shot today.png
python3 ui.py texts | grep -i -E "step|run|workout|sleep"
python3 ui.py open "synitheia://body"
sleep 3 && python3 ui.py shot body.png
```

Expected, each recorded as seen or not seen:
- Connected Context shows Health as connected, with a "synced" time and a non-zero event count.
- Today's timeline shows 4,321 steps and a workout.
- The Body screen shows 70 kg and 175 cm, attributed to Health Connect.
- If a habit named "Morning run" is added first, a "Mark Morning run done?" suggestion appears on Today.

This also answers the open question in the spec for the emulator: a sideloaded build either can read Health Connect or cannot.

- [ ] **Step 7: The policy link opens Connected Context**

```bash
python3 ui.py open "synitheia://"
"$ADB" shell am start -a androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE -n com.synitheia.app/.HealthRationaleActivity
sleep 3 && python3 ui.py shot rationale.png && python3 ui.py has "Connected Context" && echo "opens Connected Context"
```

Then the real path: open Health Connect's settings for the app (Settings → Health Connect → App permissions → Synítheia), tap the privacy-policy link there, and confirm it lands on Connected Context too.

Expected: both land on Connected Context, not Today.

- [ ] **Step 8: Delete the throwaway account and shut down**

In the app: Connected Context → Delete my account → type the email → confirm. Screenshot the result.

```bash
"$ADB" uninstall com.synitheia.app
"$ADB" emu kill
```

The emulator, the image and the AVD stay installed on the Mac for future checks. Say so in the final message, with the command to remove them: `"$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" delete avd -n synitheia-hc`.

- [ ] **Step 9: Record what was observed**

No commit. In the ledger, list each expectation from Steps 5 to 8 as observed, not observed, or not attempted, with the screenshot that shows it.

---

### Task 11: Documentation, written from what was actually observed

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Update the phase table and the known gaps**

Use the wording that matches Task 10's outcome: "built and emulator-tested, **not yet verified on a phone**" if the emulator steps passed, or "built, **not yet run on any Android device**" if Task 10 was not completed.

In the Phase 9 row ("9. Passive integrations"), change the opening `Health (iOS), Calendar, Weather and Location collectors ✅` to `Health (iOS HealthKit; Android Health Connect — <wording>), Calendar, Weather and Location collectors ✅`, and delete the trailing sentence `Android Health Connect ⬜.`

In "Known gaps", in the bullet that begins `Background sync is opportunistic`, replace

```
and Android has no Health Connect reader, so `steps`, `sleep`
  and `workouts` are iOS-only.
```

with

```
On Android, health comes from Health Connect, which holds only what the phone itself
  (Android 14+) or another app writes into it, reads in the background only with a
  separate permission, and is <wording>.
```

Keep the bullet's following sentence about the aggregator reporting `null`, and keep the table's column alignment.

- [ ] **Step 2: Check and commit**

```bash
pnpm check
git add ARCHITECTURE.md
git commit -m "docs: Android health via Health Connect"
git push origin feature/android-health-connect
```

---

## Phone checklist (for the user, after this plan)

Not a task an agent can do. Until it has been run, Android health is not verified on a device.

1. Install the APK from the branch's Android build on an Android phone (Android 9 or later; 14 or later to test the phone's own step counting).
2. Sign in. Open Connected Context and turn on Health.
3. On Health Connect's screen, check that seven data types are listed and nothing asks to write. Allow all, including background access if offered.
4. Walk for a few minutes. Reopen the app: do today's steps appear on Today?
5. Record a workout in any app that writes to Health Connect (Fitbit, Samsung Health, Google Fit). With a habit named after it ("Morning run"), does "Mark Morning run done?" appear?
6. Check the Body screen for weight, if one was logged in the last 30 days.
7. Leave the app in the background for a few hours without opening it, then check whether Health's "last synced" time moved on its own.
8. In Health Connect, open the app's permissions and tap the privacy-policy link: does it open Connected Context?
9. Turn Health off in the app, walk, reopen: steps should not update.

## Spec coverage

| Spec section | Task |
|---|---|
| Structure on the phone | Tasks 1, 2, 4, 5, 6, 7 |
| What Android reads (table, sleep, exercise names, height and weight) | Tasks 2, 4, 5 |
| Connecting (availability, grants, partial grant, update required) | Tasks 4, 5, 6, 8 |
| Policy link → Connected Context | Task 7, verified in Task 10 |
| Background | Tasks 5, 6 (the "nothing to send" rule), verified by the user's checklist |
| Build changes | Tasks 5, 7 |
| Error handling table | Tasks 4, 5, 6, 8 |
| Testing: unit | Tasks 1, 2, 4, 5, 6, 7 |
| Testing: CI builds and APK inspection | Task 9 |
| Testing: emulator | Task 10 |
| Testing: real phone | Phone checklist |
| Files touched: `ARCHITECTURE.md` | Task 11 |
