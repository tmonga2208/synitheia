import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asLocalDate, type TodayResponse } from '@synitheia/shared';
import type { WireReminder } from '../api/types.js';
import type { PlannedNotification } from './plan.js';
import type * as ScheduleModule from './schedule.js';

const mocks = vi.hoisted(() => ({
  getAllScheduledNotificationsAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  request: vi.fn(),
  hasSession: vi.fn(),
}));

vi.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: mocks.getAllScheduledNotificationsAsync,
  cancelScheduledNotificationAsync: mocks.cancelScheduledNotificationAsync,
  scheduleNotificationAsync: mocks.scheduleNotificationAsync,
  getPermissionsAsync: mocks.getPermissionsAsync,
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

vi.mock('../api/client.js', () => ({
  request: mocks.request,
  hasSession: mocks.hasSession,
}));

let schedule: typeof ScheduleModule;

// Monday 26 October 2026, 09:00 on the device.
const NOW = new Date(2026, 9, 26, 9, 0, 0);

const WATER: WireReminder = {
  _id: '6a7025c8d36b5e0013390201',
  userId: '6a7025c8d36b5e0013390001',
  kind: 'water',
  refId: null,
  label: 'Drink water',
  repeat: 'daily',
  time: '15:00',
  weekdays: [],
  intervalMinutes: null,
  windowStart: null,
  windowEnd: null,
  enabled: true,
  lastFiredAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
} as WireReminder;

const TODAY = {
  localDate: asLocalDate('2026-10-26'),
  greeting: 'Good morning',
  dailyFlow: { percent: 0, components: [] },
  streakDays: 0,
  xp: 0,
  habits: [],
  expenses: { totalMinor: 0, count: 0, budgetRemainingMinor: null },
  nutrition: { totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }, calorieTarget: 2000 },
  water: { totalMl: 0, targetMl: 2500 },
  timeline: [],
  suggestions: [],
  featuredInsight: null,
  weeklyFlow: [],
} as TodayResponse;

function scheduledWith(identifier: string, data: Record<string, unknown>) {
  return { identifier, content: { title: 't', body: 'b', data }, trigger: null };
}

function answer(path: string): unknown {
  if (path === '/reminders') return { items: [WATER] };
  if (path === '/today') return TODAY;
  if (path === '/me') return { user: { currency: 'INR' }, preferences: null };
  throw new Error(`unexpected ${path}`);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);

  mocks.getAllScheduledNotificationsAsync.mockReset().mockResolvedValue([]);
  mocks.cancelScheduledNotificationAsync.mockReset().mockResolvedValue(undefined);
  mocks.scheduleNotificationAsync.mockReset().mockResolvedValue('id');
  mocks.getPermissionsAsync.mockReset().mockResolvedValue({ granted: true, canAskAgain: true });
  mocks.request.mockReset().mockImplementation(async (path: string) => answer(path));
  mocks.hasSession.mockReset().mockResolvedValue(true);

  vi.resetModules();
  schedule = await import('./schedule.js');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('applyPlan', () => {
  it('replaces earlier reminders, including the repeating kind older builds set, and keeps suggestions', async () => {
    mocks.getAllScheduledNotificationsAsync.mockResolvedValue([
      scheduledWith('ours', { source: 'synitheia-reminder', kind: 'water' }),
      scheduledWith('old-reminder', { reminderId: '6a7025c8d36b5e0013390201' }),
      scheduledWith('old-habit', { habitId: '6a7025c8d36b5e0013390101' }),
      scheduledWith('suggestion', { suggestionId: '6a7025c8d36b5e0013390301' }),
    ]);

    await schedule.applyPlan([]);

    const cancelled = mocks.cancelScheduledNotificationAsync.mock.calls.map((call) => call[0]);
    expect(cancelled.sort()).toEqual(['old-habit', 'old-reminder', 'ours']);
  });

  it('schedules each planned reminder for its own date', async () => {
    const planned: PlannedNotification = {
      identifier: 'r@2026-10-26T15:00',
      date: new Date(2026, 9, 26, 15, 0),
      title: 'Drink water',
      body: 'Nothing logged yet today. 2.5 L to go.',
      data: {
        source: 'synitheia-reminder',
        kind: 'water',
        reminderId: 'r',
        habitId: null,
        route: '/water',
      },
    };

    await schedule.applyPlan([planned]);

    expect(mocks.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'r@2026-10-26T15:00',
      content: {
        title: 'Drink water',
        body: 'Nothing logged yet today. 2.5 L to go.',
        data: planned.data,
      },
      trigger: { type: 'date', date: new Date(2026, 9, 26, 15, 0) },
    });
  });
});

describe('refreshReminders', () => {
  it('plans from the server’s reminders and today, and schedules them', async () => {
    expect(await schedule.refreshReminders()).toBe('scheduled');

    expect(mocks.scheduleNotificationAsync).toHaveBeenCalledTimes(14);
    const first = mocks.scheduleNotificationAsync.mock.calls[0]![0] as {
      content: { body: string };
      trigger: { date: Date };
    };
    expect(first.trigger.date).toEqual(new Date(2026, 9, 26, 15, 0));
    expect(first.content.body).toBe('Nothing logged yet today. 2.5 L to go.');
  });

  it('marks its requests as background ones when it runs in the background', async () => {
    await schedule.refreshReminders({ background: true });

    expect(mocks.request).toHaveBeenCalledWith('/reminders', { background: true });
    expect(mocks.request).toHaveBeenCalledWith('/today', { background: true });
  });

  it('asks the server for the currency when it was not told it', async () => {
    await schedule.refreshReminders();
    expect(mocks.request).toHaveBeenCalledWith('/me', { background: false });

    mocks.request.mockClear();
    schedule.setReminderCurrency('USD');
    await schedule.refreshReminders();
    expect(mocks.request).not.toHaveBeenCalledWith('/me', expect.anything());
  });

  it('without notification permission, touches nothing and says so', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    mocks.getAllScheduledNotificationsAsync.mockResolvedValue([
      scheduledWith('ours', { source: 'synitheia-reminder', kind: 'water' }),
    ]);

    expect(await schedule.refreshReminders()).toBe('no-permission');
    expect(mocks.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('signed out, does nothing', async () => {
    mocks.hasSession.mockResolvedValue(false);

    expect(await schedule.refreshReminders()).toBe('signed-out');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('keeps the reminders already set when the server cannot be reached', async () => {
    mocks.request.mockRejectedValue(new TypeError('Network request failed'));

    expect(await schedule.refreshReminders()).toBe('failed');
    expect(mocks.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('runs a refresh asked for mid-run after it, never alongside it', async () => {
    let active = 0;
    let most = 0;
    mocks.request.mockImplementation(async (path: string) => {
      active += 1;
      most = Math.max(most, active);
      await Promise.resolve();
      active -= 1;
      return answer(path);
    });

    await Promise.all([schedule.refreshReminders(), schedule.refreshReminders()]);

    const reminderFetches = mocks.request.mock.calls.filter((call) => call[0] === '/reminders');
    expect(reminderFetches).toHaveLength(2);
    // Two requests per run go out together (/reminders and /today); two runs never overlap.
    expect(most).toBeLessThanOrEqual(3);
    expect(mocks.scheduleNotificationAsync).toHaveBeenCalledTimes(28);
  });
});

describe('requestReminderRefresh', () => {
  it('waits for a pause, then refreshes once', async () => {
    schedule.requestReminderRefresh();
    schedule.requestReminderRefresh();
    schedule.requestReminderRefresh();

    await vi.advanceTimersByTimeAsync(1499);
    expect(mocks.request).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(mocks.request.mock.calls.filter((call) => call[0] === '/reminders')).toHaveLength(1);
  });
});

describe('clearReminders', () => {
  it('cancels the app’s reminders and nothing else', async () => {
    mocks.getAllScheduledNotificationsAsync.mockResolvedValue([
      scheduledWith('ours', { source: 'synitheia-reminder', kind: 'water' }),
      scheduledWith('suggestion', { suggestionId: '6a7025c8d36b5e0013390301' }),
    ]);

    await schedule.clearReminders();

    expect(mocks.cancelScheduledNotificationAsync.mock.calls.map((call) => call[0])).toEqual(['ours']);
  });
});
