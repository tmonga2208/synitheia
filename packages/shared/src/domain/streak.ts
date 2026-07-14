import {
  addLocalDays,
  diffLocalDays,
  startOfLocalWeek,
  type LocalDate,
} from '../time/local-date.js';
import type { HabitFrequency } from './habit.js';

export interface StreakInput {
  /** Days on which the habit met its target. Order does not matter; duplicates are ignored. */
  completedDates: readonly LocalDate[];
  frequency: HabitFrequency;
  /** The user's today, in their timezone. Never `new Date()` — the caller owns the clock. */
  today: LocalDate;
}

export interface StreakResult {
  current: number;
  longest: number;
}

/**
 * Streak semantics, stated explicitly because every habit app gets this subtly
 * different and users notice immediately:
 *
 *  - A streak is a run of *consecutive* completed periods.
 *  - Today being incomplete does NOT break the current streak. At 9am you have not
 *    failed today's habit, you simply have not done it yet. A tracker that shows
 *    "0 day streak" every morning until you tap the box is punishing the user for
 *    the passage of time. So the current streak may end at today OR at yesterday.
 *  - Missing yesterday, with today also not done, breaks it. The grace is exactly
 *    one period wide — the current one.
 *  - Weekly habits streak over ISO weeks (Monday-anchored, matching the M–S chart).
 *  - Future-dated completions are ignored rather than trusted; a clock-skewed client
 *    must not be able to inflate a streak.
 */
export function computeStreak({
  completedDates,
  frequency,
  today,
}: StreakInput): StreakResult {
  const periods =
    frequency === 'weekly'
      ? completedDates.map(startOfLocalWeek)
      : [...completedDates];

  const currentPeriod = frequency === 'weekly' ? startOfLocalWeek(today) : today;

  // Dedupe (a weekly habit completed 3x in one week is one completed period) and
  // drop anything in the future.
  const unique = [...new Set(periods)]
    .filter((p) => p <= currentPeriod)
    .sort();

  if (unique.length === 0) return { current: 0, longest: 0 };

  const step = frequency === 'weekly' ? 7 : 1;
  const isAdjacent = (a: LocalDate, b: LocalDate) => diffLocalDays(a, b) === step;

  // Longest run anywhere in history.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    if (isAdjacent(unique[i - 1]!, unique[i]!)) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // Current run: walk backwards from the most recent completed period, but only if
  // that period is the current one or the one immediately before it.
  const latest = unique[unique.length - 1]!;
  const previousPeriod = addLocalDays(currentPeriod, -step);
  const isLive = latest === currentPeriod || latest === previousPeriod;

  let current = 0;
  if (isLive) {
    current = 1;
    for (let i = unique.length - 1; i > 0; i--) {
      if (isAdjacent(unique[i - 1]!, unique[i]!)) current += 1;
      else break;
    }
  }

  return { current, longest: Math.max(longest, current) };
}

/**
 * Completion rate over a window, used by the AI context builder.
 * `scheduledPeriods` is the denominator — a habit created last Tuesday should not
 * be scored against the whole month.
 */
export function completionRate(completed: number, scheduledPeriods: number): number {
  if (scheduledPeriods <= 0) return 0;
  return Math.min(1, completed / scheduledPeriods);
}
