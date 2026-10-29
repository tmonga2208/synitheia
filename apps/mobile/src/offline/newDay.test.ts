import { QueryClient } from '@tanstack/react-query';
import { ZERO_MACROS, type TodayResponse } from '@synitheia/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { startNewDay } from './newDay.js';

const ZONE = 'Asia/Kolkata';
/** 09:00 on 26 October in Kolkata. */
const NOW = new Date('2026-10-26T03:30:00Z');

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient();
});

function day(localDate: string, greeting = 'Good evening'): TodayResponse {
  return {
    localDate,
    greeting,
    dailyFlow: { percent: 80, components: [{ key: 'water', percent: 80, weight: 1 }] },
    streakDays: 4,
    xp: 120,
    habits: [{ id: 'h1', name: 'Read', targetCount: 1, todayCount: 1, todayComplete: true }],
    expenses: { totalMinor: 45_000, count: 3, budgetRemainingMinor: 900_000 },
    nutrition: {
      totals: { calories: 1800, proteinG: 90, carbsG: 200, fatG: 60 },
      calorieTarget: 2200,
    },
    water: { totalMl: 1500, targetMl: 2000 },
    timeline: [{ id: 'ev1' }],
    suggestions: [{ id: 's1' }],
    featuredInsight: null,
    weeklyFlow: [
      { localDate: '2026-10-25', percent: 80, isToday: true },
      { localDate: '2026-10-26', percent: 0, isToday: false },
    ],
  } as unknown as TodayResponse;
}

const today = () => client.getQueryData<TodayResponse>(['today'])!;

describe('startNewDay', () => {
  it('starts Today afresh when what is shown is from an earlier day', () => {
    client.setQueryData(['today'], day('2026-10-25'));

    const rolled = startNewDay(client, ZONE, NOW);

    expect(rolled).toEqual([['today']]);
    expect(today()).toMatchObject({
      localDate: '2026-10-26',
      greeting: 'Good morning',
      dailyFlow: { percent: 0, components: [{ key: 'water', percent: 0, weight: 1 }] },
      habits: [{ id: 'h1', todayCount: 0, todayComplete: false }],
      expenses: { totalMinor: 0, count: 0, budgetRemainingMinor: 900_000 },
      nutrition: { totals: ZERO_MACROS, calorieTarget: 2200 },
      water: { totalMl: 0, targetMl: 2000 },
      timeline: [],
      suggestions: [],
      // What does not reset at midnight stays until the server says otherwise.
      streakDays: 4,
      xp: 120,
    });
    expect(today().weeklyFlow.map((d) => d.isToday)).toEqual([false, true]);
  });

  it('moves the chart’s week along by a day when the new day is not in it', () => {
    const week = Array.from({ length: 7 }, (_, i) => ({
      localDate: `2026-10-${String(19 + i).padStart(2, '0')}`,
      percent: 50,
      isToday: i === 6,
    }));
    client.setQueryData(['today'], { ...day('2026-10-25'), weeklyFlow: week });

    startNewDay(client, ZONE, NOW);

    expect(today().weeklyFlow.map((d) => d.localDate)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
    expect(today().weeklyFlow.at(-1)).toEqual({ localDate: '2026-10-26', percent: 0, isToday: true });
    expect(today().weeklyFlow.filter((d) => d.isToday)).toHaveLength(1);
  });

  it('leaves today’s numbers alone, and only brings the greeting up to date', () => {
    client.setQueryData(['today'], day('2026-10-26', 'Good evening'));

    const rolled = startNewDay(client, ZONE, NOW);

    expect(rolled).toEqual([]);
    expect(today().greeting).toBe('Good morning');
    expect(today().water.totalMl).toBe(1500);
  });

  it('empties the water and food lists fetched on an earlier day, and only those', () => {
    client.setQueryData(
      ['water'],
      {
        items: [{ _id: 'w1', amountMl: 250, loggedAt: '2026-10-25T14:00:00Z' }],
        totalMl: 250,
        targetMl: 2000,
      },
      // 20:30 on the 25th in Kolkata.
      { updatedAt: Date.parse('2026-10-25T15:00:00Z') },
    );
    client.setQueryData(
      ['food'],
      {
        items: [{ _id: 'f1' }],
        daily: { totals: { ...ZERO_MACROS, calories: 300 }, entryCount: 1 },
      },
      // 07:30 on the 26th in Kolkata.
      { updatedAt: Date.parse('2026-10-26T02:00:00Z') },
    );

    const rolled = startNewDay(client, ZONE, NOW);

    expect(rolled).toEqual([['water']]);
    expect(client.getQueryData(['water'])).toEqual({ items: [], totalMl: 0, targetMl: 2000 });
    expect(client.getQueryData(['food'])).toMatchObject({ daily: { entryCount: 1 } });
  });

  it('does nothing when nothing is cached', () => {
    expect(startNewDay(client, ZONE, NOW)).toEqual([]);
  });
});
