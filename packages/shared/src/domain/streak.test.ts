import { describe, expect, it } from 'vitest';
import { asLocalDate, type LocalDate } from '../time/local-date.js';
import { completionRate, computeStreak } from './streak.js';

const d = (s: string): LocalDate => asLocalDate(s);
const days = (...s: string[]) => s.map(d);

describe('computeStreak — daily', () => {
  const today = d('2026-07-12');

  it('is zero with no completions', () => {
    expect(computeStreak({ completedDates: [], frequency: 'daily', today })).toEqual({
      current: 0,
      longest: 0,
    });
  });

  it('counts a run ending today', () => {
    const r = computeStreak({
      completedDates: days('2026-07-10', '2026-07-11', '2026-07-12'),
      frequency: 'daily',
      today,
    });
    expect(r.current).toBe(3);
    expect(r.longest).toBe(3);
  });

  it('does NOT break the streak just because today is not done yet', () => {
    // It is 9am. The user has a 3-day streak and has not yet done today's habit.
    // Showing them "0" would be punishing them for the passage of time.
    const r = computeStreak({
      completedDates: days('2026-07-09', '2026-07-10', '2026-07-11'),
      frequency: 'daily',
      today,
    });
    expect(r.current).toBe(3);
  });

  it('breaks when yesterday was missed and today is not done', () => {
    const r = computeStreak({
      completedDates: days('2026-07-08', '2026-07-09', '2026-07-10'),
      frequency: 'daily',
      today,
    });
    expect(r.current).toBe(0);
    expect(r.longest).toBe(3); // history is preserved
  });

  it('revives to 1 when the user does it today after a gap', () => {
    const r = computeStreak({
      completedDates: days('2026-07-01', '2026-07-02', '2026-07-12'),
      frequency: 'daily',
      today,
    });
    expect(r.current).toBe(1);
    expect(r.longest).toBe(2);
  });

  it('reports the longest historical run even when the current is shorter', () => {
    const r = computeStreak({
      completedDates: days(
        '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05',
        '2026-07-11', '2026-07-12',
      ),
      frequency: 'daily',
      today,
    });
    expect(r.current).toBe(2);
    expect(r.longest).toBe(5);
  });

  it('ignores duplicate dates', () => {
    const r = computeStreak({
      completedDates: days('2026-07-11', '2026-07-11', '2026-07-12'),
      frequency: 'daily',
      today,
    });
    expect(r.current).toBe(2);
  });

  it('is order-independent', () => {
    const r = computeStreak({
      completedDates: days('2026-07-12', '2026-07-10', '2026-07-11'),
      frequency: 'daily',
      today,
    });
    expect(r.current).toBe(3);
  });

  it('ignores future-dated completions from a skewed client clock', () => {
    // A device with a wrong clock must not be able to inflate a streak.
    const r = computeStreak({
      completedDates: days('2026-07-12', '2026-07-13', '2026-07-14'),
      frequency: 'daily',
      today,
    });
    expect(r.current).toBe(1);
    expect(r.longest).toBe(1);
  });

  it('counts a streak across a month boundary', () => {
    const r = computeStreak({
      completedDates: days('2026-06-29', '2026-06-30', '2026-07-01'),
      frequency: 'daily',
      today: d('2026-07-01'),
    });
    expect(r.current).toBe(3);
  });

  it('counts a streak across a year boundary', () => {
    const r = computeStreak({
      completedDates: days('2025-12-31', '2026-01-01'),
      frequency: 'daily',
      today: d('2026-01-01'),
    });
    expect(r.current).toBe(2);
  });

  it('counts a streak across a DST transition as unbroken', () => {
    // 2026-03-08 is US spring-forward. A 23-hour day is still one day.
    const r = computeStreak({
      completedDates: days('2026-03-07', '2026-03-08', '2026-03-09'),
      frequency: 'daily',
      today: d('2026-03-09'),
    });
    expect(r.current).toBe(3);
  });

  it('reproduces the 12-day streak in the design reference', () => {
    const dates: string[] = [];
    for (let i = 0; i < 12; i++) dates.push(`2026-07-${String(i + 1).padStart(2, '0')}`);
    const r = computeStreak({
      completedDates: days(...dates),
      frequency: 'daily',
      today,
    });
    expect(r.current).toBe(12);
  });
});

describe('computeStreak — weekly', () => {
  // 2026-07-12 is a Sunday; its week is Mon 2026-07-06 .. Sun 2026-07-12.
  const today = d('2026-07-12');

  it('collapses several completions in one week into a single period', () => {
    const r = computeStreak({
      completedDates: days('2026-07-06', '2026-07-08', '2026-07-10'),
      frequency: 'weekly',
      today,
    });
    expect(r.current).toBe(1);
  });

  it('counts consecutive weeks', () => {
    const r = computeStreak({
      completedDates: days('2026-06-24', '2026-07-01', '2026-07-08'),
      frequency: 'weekly',
      today,
    });
    expect(r.current).toBe(3);
  });

  it('does not break when the current week is not yet done', () => {
    // Weeks of Jun 22 and Jun 29. Current week (Jul 6) not yet done — but the
    // previous week was, so the streak is still live.
    const r = computeStreak({
      completedDates: days('2026-06-24', '2026-07-01'),
      frequency: 'weekly',
      today,
    });
    expect(r.current).toBe(2);
  });

  it('breaks when the previous week was missed', () => {
    const r = computeStreak({
      completedDates: days('2026-06-17', '2026-06-24'),
      frequency: 'weekly',
      today,
    });
    expect(r.current).toBe(0);
    expect(r.longest).toBe(2);
  });

  it('treats a Sunday and the following Monday as different weeks', () => {
    // Sun 2026-07-05 is in the week of Jun 29; Mon 2026-07-06 starts a new one.
    const r = computeStreak({
      completedDates: days('2026-07-05', '2026-07-06'),
      frequency: 'weekly',
      today,
    });
    expect(r.current).toBe(2);
  });
});

describe('completionRate', () => {
  it('divides completed by scheduled', () => {
    expect(completionRate(6, 7)).toBeCloseTo(0.857, 3);
  });

  it('is zero when nothing was scheduled — never NaN or Infinity', () => {
    // A habit created today has no scheduled history. An insight reading NaN here
    // would render as "NaN% completion".
    expect(completionRate(0, 0)).toBe(0);
    expect(completionRate(5, 0)).toBe(0);
  });

  it('clamps to 1 when over-completed', () => {
    expect(completionRate(9, 7)).toBe(1);
  });
});
