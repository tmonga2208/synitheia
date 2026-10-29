import { describe, expect, it } from 'vitest';
import type { TodayResponse } from '@synitheia/shared';
import { addAmount, amountScale, parseAmount, quickAmounts, snapAmount, withHabitCount } from './logAmount.js';

type TodayHabit = TodayResponse['habits'][number];

const habit = (overrides: Partial<TodayHabit>): TodayHabit =>
  ({ id: 'h1', name: 'Reading', measure: 'duration', unit: 'min', targetCount: 30, todayCount: 0, todayComplete: false, ...overrides }) as TodayHabit;

describe('quickAmounts', () => {
  it('offers amounts that fit the measure', () => {
    expect(quickAmounts('duration')).toEqual([5, 15, 30]);
    expect(quickAmounts('steps')).toEqual([500, 1000, 2000]);
    expect(quickAmounts('count')).toEqual([1, 2, 5]);
  });
});

describe('amountScale', () => {
  it('moves minutes one at a time and steps a hundred at a time', () => {
    expect(amountScale(habit({ measure: 'duration', targetCount: 30 })).step).toBe(1);
    expect(amountScale(habit({ measure: 'steps', targetCount: 8000 })).step).toBe(100);
  });

  it('reaches past the target, and past what is already logged', () => {
    expect(amountScale(habit({ targetCount: 30, todayCount: 0 })).max).toBe(45);
    expect(amountScale(habit({ measure: 'steps', targetCount: 8000, todayCount: 15000 })).max).toBeGreaterThan(15000);
  });
});

describe('addAmount', () => {
  it('has no ceiling, only a floor at zero', () => {
    expect(addAmount(99, 30)).toBe(129);
    expect(addAmount(9000, 2000)).toBe(11000);
    expect(addAmount(10, -15)).toBe(0);
  });
});

describe('parseAmount', () => {
  it('reads whole numbers, with or without grouping commas', () => {
    expect(parseAmount('180')).toBe(180);
    expect(parseAmount('25,000')).toBe(25000);
    expect(parseAmount(' 0 ')).toBe(0);
  });

  it('refuses what is not a whole amount', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('1.5')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

describe('amountScale growth', () => {
  it('always leaves room past a long day', () => {
    expect(amountScale(habit({ targetCount: 45, todayCount: 99 })).max).toBeGreaterThan(120);
    expect(amountScale(habit({ measure: 'steps', targetCount: 10000, todayCount: 30000 })).max).toBeGreaterThan(37000);
  });
});

describe('snapAmount', () => {
  it('rounds to the scale step and stays inside 0..max', () => {
    expect(snapAmount(1234, { step: 100, max: 12000 })).toBe(1200);
    expect(snapAmount(-20, { step: 1, max: 45 })).toBe(0);
    expect(snapAmount(99, { step: 1, max: 45 })).toBe(45);
  });
});

describe('withHabitCount', () => {
  const today = { habits: [habit({ id: 'h1', todayCount: 10 }), habit({ id: 'h2', todayCount: 3 })] } as TodayResponse;

  it("changes only that habit's count, and its completion with it", () => {
    const next = withHabitCount(today, 'h1', (c) => c + 25);
    expect(next.habits[0]).toMatchObject({ todayCount: 35, todayComplete: true });
    expect(next.habits[1]).toMatchObject({ todayCount: 3 });
  });

  it('never goes below zero', () => {
    expect(withHabitCount(today, 'h1', (c) => c - 50).habits[0]!.todayCount).toBe(0);
  });
});
