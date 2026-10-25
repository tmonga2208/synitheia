import { describe, expect, it } from 'vitest';
import {
  MAX_INTERVAL_SLOTS,
  createReminderSchema,
  reminderShapeSchema,
  slotCount,
  slotTimes,
  updateReminderSchema,
} from './reminder.js';

describe('reminderShapeSchema', () => {
  const stored = {
    repeat: 'interval' as const,
    time: null,
    intervalMinutes: 60,
    windowStart: '09:00',
    windowEnd: '21:00',
  };

  it('accepts a stored interval reminder that fires', () => {
    expect(reminderShapeSchema.safeParse(stored).success).toBe(true);
  });

  it('refuses a stored window that ends before it starts', () => {
    expect(reminderShapeSchema.safeParse({ ...stored, windowStart: '23:00' }).success).toBe(false);
  });

  it('refuses a stored daily reminder with no time', () => {
    expect(reminderShapeSchema.safeParse({ ...stored, repeat: 'daily', time: null }).success).toBe(false);
  });
});

describe('slotTimes', () => {
  it('steps from start through end, inclusive', () => {
    expect(slotTimes('09:00', '10:00', 30)).toEqual(['09:00', '09:30', '10:00']);
  });

  it('includes the end only when a slot lands exactly on it', () => {
    expect(slotTimes('09:00', '09:50', 30)).toEqual(['09:00', '09:30']);
  });

  it('yields a single slot when the window is a point', () => {
    expect(slotTimes('09:00', '09:00', 15)).toEqual(['09:00']);
  });

  it('pads hours and minutes', () => {
    expect(slotTimes('08:05', '08:35', 15)).toEqual(['08:05', '08:20', '08:35']);
  });
});

describe('slotCount', () => {
  it('counts the slots a window+interval would schedule', () => {
    expect(slotCount('09:00', '21:00', 30)).toBe(25); // 12h / 30m + 1
    expect(slotCount('09:00', '15:00', 15)).toBe(25); // 6h / 15m + 1
  });
});

const base = { kind: 'custom' as const, label: 'Drink water' };

describe('createReminderSchema — daily', () => {
  it('accepts a daily reminder with a time', () => {
    const parsed = createReminderSchema.parse({ ...base, repeat: 'daily', time: '19:30' });
    expect(parsed.repeat).toBe('daily');
    expect(parsed.weekdays).toEqual([]);
  });

  it('defaults repeat to daily', () => {
    expect(createReminderSchema.parse({ ...base, time: '19:30' }).repeat).toBe('daily');
  });

  it('rejects a daily reminder with no time', () => {
    expect(createReminderSchema.safeParse({ ...base, repeat: 'daily' }).success).toBe(false);
  });
});

describe('createReminderSchema — interval', () => {
  it('accepts an all-day interval reminder', () => {
    const parsed = createReminderSchema.parse({
      ...base,
      repeat: 'interval',
      intervalMinutes: 30,
    });
    expect(parsed.intervalMinutes).toBe(30);
  });

  it('accepts an active-hours interval reminder within the slot cap', () => {
    const parsed = createReminderSchema.parse({
      ...base,
      repeat: 'interval',
      intervalMinutes: 30,
      windowStart: '09:00',
      windowEnd: '20:30',
    });
    expect(parsed.windowStart).toBe('09:00');
  });

  it('rejects an interval reminder with no interval', () => {
    expect(
      createReminderSchema.safeParse({ ...base, repeat: 'interval' }).success,
    ).toBe(false);
  });

  it('rejects a half-set window', () => {
    expect(
      createReminderSchema.safeParse({
        ...base,
        repeat: 'interval',
        intervalMinutes: 30,
        windowStart: '09:00',
      }).success,
    ).toBe(false);
  });

  it('rejects a window that ends before it starts', () => {
    expect(
      createReminderSchema.safeParse({
        ...base,
        repeat: 'interval',
        intervalMinutes: 30,
        windowStart: '21:00',
        windowEnd: '09:00',
      }).success,
    ).toBe(false);
  });

  it('rejects a window+interval that exceeds the slot cap', () => {
    const result = createReminderSchema.safeParse({
      ...base,
      repeat: 'interval',
      intervalMinutes: 15,
      windowStart: '09:00',
      windowEnd: '21:00', // 49 slots > cap
    });
    expect(result.success).toBe(false);
    expect(slotCount('09:00', '21:00', 15)).toBeGreaterThan(MAX_INTERVAL_SLOTS);
  });
});

describe('updateReminderSchema', () => {
  it('allows a bare enabled toggle without resending mode fields', () => {
    expect(updateReminderSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('validates the mode shape when repeat is part of the patch', () => {
    expect(updateReminderSchema.safeParse({ repeat: 'interval' }).success).toBe(false);
    expect(
      updateReminderSchema.safeParse({ repeat: 'interval', intervalMinutes: 60 }).success,
    ).toBe(true);
  });
});
