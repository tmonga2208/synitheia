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
