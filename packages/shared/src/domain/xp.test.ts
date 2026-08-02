import { describe, expect, it } from 'vitest';
import { asLocalDate } from '../time/local-date.js';
import {
  XP_AMOUNTS,
  awardForMonth,
  awardsForHabitLog,
  awardsForWaterEntry,
} from './xp.js';

const DAY = asLocalDate('2026-08-02');
const HABIT = '6a6e43f1c18dd7ea6400da86';

describe('awardsForHabitLog', () => {
  it('awards nothing when the habit is not complete', () => {
    expect(
      awardsForHabitLog({
        habitId: HABIT,
        localDate: DAY,
        complete: false,
        currentStreak: 3,
        scheduledCount: 3,
        completedCount: 1,
      }),
    ).toEqual([]);
  });

  it('awards the habit itself on completion', () => {
    const awards = awardsForHabitLog({
      habitId: HABIT,
      localDate: DAY,
      complete: true,
      currentStreak: 1,
      scheduledCount: 3,
      completedCount: 1,
    });

    expect(awards).toEqual([
      { key: `habit:${HABIT}:2026-08-02`, amount: XP_AMOUNTS.habitComplete },
    ]);
  });

  it('adds the day bonus only when every scheduled habit is done', () => {
    const partial = awardsForHabitLog({
      habitId: HABIT,
      localDate: DAY,
      complete: true,
      currentStreak: 1,
      scheduledCount: 3,
      completedCount: 2,
    });
    expect(partial.map((a) => a.key)).not.toContain('day:2026-08-02');

    const full = awardsForHabitLog({
      habitId: HABIT,
      localDate: DAY,
      complete: true,
      currentStreak: 1,
      scheduledCount: 3,
      completedCount: 3,
    });
    expect(full).toContainEqual({ key: 'day:2026-08-02', amount: XP_AMOUNTS.dayComplete });
  });

  it('does not award a day bonus when nothing was scheduled', () => {
    const awards = awardsForHabitLog({
      habitId: HABIT,
      localDate: DAY,
      complete: true,
      currentStreak: 1,
      scheduledCount: 0,
      completedCount: 0,
    });
    expect(awards.map((a) => a.key)).not.toContain('day:2026-08-02');
  });

  it('awards a streak milestone at the boundary and not before', () => {
    const six = awardsForHabitLog({
      habitId: HABIT,
      localDate: DAY,
      complete: true,
      currentStreak: 6,
      scheduledCount: 1,
      completedCount: 1,
    });
    expect(six.map((a) => a.key)).not.toContain(`streak:${HABIT}:7`);

    const seven = awardsForHabitLog({
      habitId: HABIT,
      localDate: DAY,
      complete: true,
      currentStreak: 7,
      scheduledCount: 1,
      completedCount: 1,
    });
    expect(seven).toContainEqual({
      key: `streak:${HABIT}:7`,
      amount: XP_AMOUNTS.streak[7],
    });
  });

  it('offers every milestone at or below the current streak', () => {
    // Not "exactly equals": a recomputed streak can arrive already past a milestone,
    // and the ledger's unique index makes re-offering an already-granted one free.
    const awards = awardsForHabitLog({
      habitId: HABIT,
      localDate: DAY,
      complete: true,
      currentStreak: 30,
      scheduledCount: 1,
      completedCount: 1,
    });

    expect(awards.map((a) => a.key)).toEqual(
      expect.arrayContaining([`streak:${HABIT}:7`, `streak:${HABIT}:30`]),
    );
    expect(awards.map((a) => a.key)).not.toContain(`streak:${HABIT}:100`);
  });

  it('never returns a zero or negative amount', () => {
    const awards = awardsForHabitLog({
      habitId: HABIT,
      localDate: DAY,
      complete: true,
      currentStreak: 100,
      scheduledCount: 1,
      completedCount: 1,
    });
    for (const a of awards) expect(a.amount).toBeGreaterThan(0);
  });
});

describe('awardsForWaterEntry', () => {
  it('awards nothing below the target', () => {
    expect(
      awardsForWaterEntry({ localDate: DAY, totalMl: 2499, targetMl: 2500 }),
    ).toEqual([]);
  });

  it('awards on reaching the target exactly', () => {
    expect(
      awardsForWaterEntry({ localDate: DAY, totalMl: 2500, targetMl: 2500 }),
    ).toEqual([{ key: 'water:2026-08-02', amount: XP_AMOUNTS.waterTarget }]);
  });

  it('awards once past the target, with the same key', () => {
    const awards = awardsForWaterEntry({ localDate: DAY, totalMl: 9000, targetMl: 2500 });
    expect(awards).toEqual([{ key: 'water:2026-08-02', amount: XP_AMOUNTS.waterTarget }]);
  });
});

describe('awardForMonth', () => {
  it('awards when the month closed within budget', () => {
    expect(awardForMonth({ month: '2026-07', spentMinor: 40000, budgetMinor: 50000 })).toEqual(
      { key: 'budget:2026-07', amount: XP_AMOUNTS.monthInBudget },
    );
  });

  it('awards when spending exactly equals the budget', () => {
    expect(
      awardForMonth({ month: '2026-07', spentMinor: 50000, budgetMinor: 50000 }),
    ).not.toBeNull();
  });

  it('awards nothing over budget — and never a deduction', () => {
    expect(awardForMonth({ month: '2026-07', spentMinor: 50001, budgetMinor: 50000 })).toBeNull();
  });

  it('awards nothing when no budget is set', () => {
    expect(awardForMonth({ month: '2026-07', spentMinor: 0, budgetMinor: null })).toBeNull();
  });
});
