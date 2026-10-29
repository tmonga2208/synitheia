import { describe, expect, it } from 'vitest';
import { asLocalDate, type TodayResponse } from '@synitheia/shared';
import type { WireReminder } from '../api/types.js';
import { planNotifications, type PlanInput } from './plan.js';

// Monday 26 October 2026, 09:00 on the device.
const NOW = new Date(2026, 9, 26, 9, 0, 0);

type TodayHabit = TodayResponse['habits'][number];

const READING_ID = '6a7025c8d36b5e0013390101';

function habit(overrides: Partial<TodayHabit> = {}): TodayHabit {
  return {
    id: READING_ID,
    userId: '6a7025c8d36b5e0013390001',
    name: 'Reading',
    icon: 'book-open',
    color: '#7D927D',
    category: null,
    frequency: 'daily',
    measure: 'check',
    targetCount: 1,
    unit: null,
    reminderTime: null,
    currentStreak: 3,
    longestStreak: 5,
    archivedAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    todayCount: 0,
    todayComplete: false,
    ...overrides,
  } as TodayHabit;
}

function today(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return {
    localDate: asLocalDate('2026-10-26'),
    greeting: 'Good morning',
    dailyFlow: { percent: 40, components: [] },
    streakDays: 3,
    xp: 120,
    habits: [habit()],
    expenses: { totalMinor: 0, count: 0, budgetRemainingMinor: null },
    nutrition: { totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }, calorieTarget: 2000 },
    water: { totalMl: 0, targetMl: 2500 },
    timeline: [],
    suggestions: [],
    featuredInsight: null,
    weeklyFlow: [],
    ...overrides,
  } as TodayResponse;
}

function reminder(overrides: Partial<WireReminder> = {}): WireReminder {
  return {
    _id: '6a7025c8d36b5e0013390201',
    userId: '6a7025c8d36b5e0013390001',
    kind: 'water',
    refId: null,
    label: 'Drink water',
    time: '15:00',
    weekdays: [],
    enabled: true,
    lastFiredAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  } as WireReminder;
}

function plan(input: Partial<PlanInput> = {}) {
  return planNotifications({
    now: NOW,
    reminders: [reminder()],
    today: today({ habits: [] }),
    currency: 'INR',
    ...input,
  });
}

describe('when reminders are planned', () => {
  it('plans a daily reminder once a day for two weeks, starting today', () => {
    const planned = plan();

    expect(planned).toHaveLength(14);
    expect(planned[0]!.date).toEqual(new Date(2026, 9, 26, 15, 0));
    expect(planned[13]!.date).toEqual(new Date(2026, 10, 8, 15, 0));
  });

  it('skips a time that has already passed today', () => {
    const planned = plan({ reminders: [reminder({ time: '08:00' })] });

    expect(planned).toHaveLength(13);
    expect(planned[0]!.date).toEqual(new Date(2026, 9, 27, 8, 0));
  });

  it('counts weekdays from Monday', () => {
    const mondays = plan({ reminders: [reminder({ weekdays: [0] })] });
    expect(mondays.map((p) => p.date)).toEqual([
      new Date(2026, 9, 26, 15, 0),
      new Date(2026, 10, 2, 15, 0),
    ]);

    const sundays = plan({ reminders: [reminder({ weekdays: [6] })] });
    expect(sundays.map((p) => p.date)).toEqual([
      new Date(2026, 10, 1, 15, 0),
      new Date(2026, 10, 8, 15, 0),
    ]);
  });

  it('plans nothing for a reminder that is switched off', () => {
    expect(plan({ reminders: [reminder({ enabled: false })] })).toEqual([]);
  });

  it('keeps only the soonest when there are more than the phone will hold', () => {
    const planned = plan({
      reminders: [
        reminder({ _id: '6a7025c8d36b5e0013390202', time: '10:00' }),
        reminder({ _id: '6a7025c8d36b5e0013390203', time: '11:00' }),
      ],
      maxNotifications: 3,
    });

    expect(planned.map((p) => p.date)).toEqual([
      new Date(2026, 9, 26, 10, 0),
      new Date(2026, 9, 26, 11, 0),
      new Date(2026, 9, 27, 10, 0),
    ]);
  });

  it('names each occurrence the same way every time, and never twice', () => {
    const first = plan().map((p) => p.identifier);
    const second = plan().map((p) => p.identifier);

    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
    expect(first[0]).toBe('6a7025c8d36b5e0013390201@2026-10-26T15:00');
  });
});

describe('a water reminder', () => {
  it('says how much is left when nothing is logged', () => {
    expect(plan()[0]!.body).toBe('Nothing logged yet today. 2.5 L to go.');
  });

  it('says where you are today', () => {
    const planned = plan({ today: today({ habits: [], water: { totalMl: 1250, targetMl: 2500 } }) });

    expect(planned[0]!.title).toBe('Drink water');
    expect(planned[0]!.body).toBe('1.25 L of 2.5 L so far. 1.25 L to go.');
  });

  it('starts the next days from nothing', () => {
    const planned = plan({ today: today({ habits: [], water: { totalMl: 1250, targetMl: 2500 } }) });

    expect(planned[1]!.body).toBe('Nothing logged yet today. 2.5 L to go.');
  });

  it('does not nudge once today’s target is reached', () => {
    const planned = plan({ today: today({ habits: [], water: { totalMl: 2500, targetMl: 2500 } }) });

    expect(planned).toHaveLength(13);
    expect(planned[0]!.date).toEqual(new Date(2026, 9, 27, 15, 0));
  });

  it('applies today’s progress only to the day the account calls today', () => {
    // The account's day is a day behind the phone's (travel). Its full glass of water
    // belongs to the 25th, so the phone's 26th still gets its reminder.
    const planned = plan({
      today: today({
        localDate: asLocalDate('2026-10-25'),
        habits: [],
        water: { totalMl: 2500, targetMl: 2500 },
      }),
    });

    expect(planned[0]!.date).toEqual(new Date(2026, 9, 26, 15, 0));
    expect(planned[0]!.body).toBe('Nothing logged yet today. 2.5 L to go.');
  });

  it('opens the water screen', () => {
    expect(plan()[0]!.data).toEqual({
      source: 'synitheia-reminder',
      kind: 'water',
      reminderId: '6a7025c8d36b5e0013390201',
      habitId: null,
      route: '/water',
    });
  });
});

describe('a habit’s own reminder time', () => {
  it('reminds about that habit by name, and opens Today', () => {
    const planned = plan({
      reminders: [],
      today: today({ habits: [habit({ reminderTime: '21:00' })] }),
    });

    expect(planned).toHaveLength(14);
    expect(planned[0]).toMatchObject({
      identifier: `habit-${READING_ID}@2026-10-26T21:00`,
      title: 'Reading',
      body: 'Not done yet today. Tap to tick it off.',
      data: {
        source: 'synitheia-reminder',
        kind: 'habit',
        reminderId: null,
        habitId: READING_ID,
        route: '/',
      },
    });
  });

  it('stays quiet today once the habit is done', () => {
    const planned = plan({
      reminders: [],
      today: today({ habits: [habit({ reminderTime: '21:00', todayComplete: true, todayCount: 1 })] }),
    });

    expect(planned[0]!.date).toEqual(new Date(2026, 9, 27, 21, 0));
  });

  it('says how far a counted habit has got', () => {
    const steps = habit({
      name: 'Walk',
      measure: 'steps',
      targetCount: 8000,
      todayCount: 3500,
      reminderTime: '18:00',
    });
    const planned = plan({ reminders: [], today: today({ habits: [steps] }) });

    expect(planned[0]!.body).toBe('3,500 / 8,000 steps so far. Tap to log more.');
    expect(planned[1]!.body).toBe('Not started yet today. 8,000 steps to go.');
  });
});

describe('a reminder about habits', () => {
  const others = [
    habit({ id: '6a7025c8d36b5e0013390102', name: 'Walk' }),
    habit({ id: '6a7025c8d36b5e0013390103', name: 'Stretch' }),
    habit({ id: '6a7025c8d36b5e0013390104', name: 'Journal' }),
  ];

  it('follows the habit it names', () => {
    const about = reminder({ kind: 'habit', refId: READING_ID, label: 'Read before bed', time: '21:00' });

    const done = plan({ reminders: [about], today: today({ habits: [habit({ todayComplete: true })] }) });
    expect(done[0]!.date).toEqual(new Date(2026, 9, 27, 21, 0));
    expect(done[0]!.title).toBe('Read before bed');

    // Archived habits are not in Today, so a reminder about one has nothing to remind of.
    expect(plan({ reminders: [about], today: today({ habits: [] }) })).toEqual([]);
  });

  it('without a habit, says how the day is going', () => {
    const all = reminder({ kind: 'habit', refId: null, label: 'Habits', time: '20:00' });

    const someDone = plan({
      reminders: [all],
      today: today({ habits: [habit({ todayComplete: true, todayCount: 1 }), ...others] }),
    });
    expect(someDone[0]!.body).toBe('1 of 4 habits done today. Still to do: Walk, Stretch and 1 more.');

    const twoLeft = plan({
      reminders: [all],
      today: today({ habits: [habit({ todayComplete: true, todayCount: 1 }), ...others.slice(0, 2)] }),
    });
    expect(twoLeft[0]!.body).toBe('1 of 3 habits done today. Still to do: Walk and Stretch.');

    const noneDone = plan({ reminders: [all], today: today({ habits: [habit(), ...others] }) });
    expect(noneDone[0]!.body).toBe('4 habits to do today.');

    const one = plan({ reminders: [all], today: today({ habits: [habit()] }) });
    expect(one[0]!.body).toBe('1 habit to do today.');
  });

  it('stays quiet today when every habit is done', () => {
    const all = reminder({ kind: 'habit', refId: null, label: 'Habits', time: '20:00' });
    const planned = plan({
      reminders: [all],
      today: today({ habits: [habit({ todayComplete: true, todayCount: 1 })] }),
    });

    expect(planned[0]!.date).toEqual(new Date(2026, 9, 27, 20, 0));
  });
});

describe('food, spending and custom reminders', () => {
  it('a food reminder says what is logged and opens nutrition', () => {
    const food = reminder({ kind: 'food', label: 'Lunch', time: '13:00' });

    const empty = plan({ reminders: [food] });
    expect(empty[0]!.body).toBe('Nothing logged yet today. Tap to add what you ate.');
    expect(empty[0]!.data.route).toBe('/nutrition');

    const logged = plan({
      reminders: [food],
      today: today({
        habits: [],
        nutrition: {
          totals: { calories: 1240, proteinG: 40, carbsG: 150, fatG: 40 },
          calorieTarget: 2000,
        },
      }),
    });
    expect(logged[0]!.body).toBe('1,240 of 2,000 kcal logged today. Tap to add a meal.');
  });

  it('a spending reminder says what is logged and opens a new expense', () => {
    const spend = reminder({ kind: 'expense', label: 'Expenses', time: '21:30' });

    const empty = plan({ reminders: [spend] });
    expect(empty[0]!.body).toBe('Nothing logged yet today. Tap to add what you spent.');
    expect(empty[0]!.data.route).toBe('/expenses/new');

    const logged = plan({
      reminders: [spend],
      today: today({
        habits: [],
        expenses: { totalMinor: 32000, count: 2, budgetRemainingMinor: null },
      }),
    });
    expect(logged[0]!.body).toBe('₹320 logged today. Tap to add another.');
  });

  it('a custom reminder is its own words, and opens Today', () => {
    const custom = reminder({ kind: 'custom', label: 'Call Mum', time: '19:00' });
    const planned = plan({ reminders: [custom] });

    expect(planned[0]!.title).toBe('Call Mum');
    expect(planned[0]!.body).toBe('');
    expect(planned[0]!.data.route).toBe('/');
  });
});

describe('interval reminders', () => {
  const every = (intervalMinutes: number, windowStart: string | null, windowEnd: string | null) =>
    reminder({ repeat: 'interval', time: null, intervalMinutes, windowStart, windowEnd });

  it('nudges at every slot of its window, every day', () => {
    const planned = plan({ reminders: [every(60, '10:00', '12:00')], horizonDays: 2 });

    expect(planned.map((p) => [p.date.getDate(), p.date.getHours()])).toEqual([
      [26, 10], [26, 11], [26, 12],
      [27, 10], [27, 11], [27, 12],
    ]);
  });

  it('nudges around the clock when it has no window', () => {
    // NOW is 09:00, so today's 00:00 and 06:00 have already passed.
    const planned = plan({ reminders: [every(360, null, null)], horizonDays: 1 });

    expect(planned.map((p) => p.date.getHours())).toEqual([12, 18]);
  });

  it('gives every slot its own identifier, so none replaces another', () => {
    const planned = plan({ reminders: [every(30, '10:00', '11:00')], horizonDays: 1 });

    expect(planned).toHaveLength(3);
    expect(new Set(planned.map((p) => p.identifier)).size).toBe(3);
  });

  it('stops nudging about water once the day’s target is met', () => {
    const planned = plan({
      reminders: [every(60, '10:00', '12:00')],
      today: today({ habits: [], water: { totalMl: 2500, targetMl: 2500 } }),
      horizonDays: 1,
    });

    expect(planned).toEqual([]);
  });

  it('skips a daily reminder that has no time', () => {
    expect(plan({ reminders: [reminder({ time: null })] })).toEqual([]);
  });
});
