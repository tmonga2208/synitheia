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
