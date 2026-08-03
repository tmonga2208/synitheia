import type { LocalDate } from '../time/local-date.js';

/**
 * XP is a record of effort, never a score: no levels, no thresholds, nothing to
 * fall short of. Every function below returns `[]` (or `null` for the month award)
 * rather than throwing, and never returns a zero or negative amount — there is no
 * such thing as a penalty here.
 *
 * This is the only place a number is attached to an action. Tasks that consume
 * this module read amounts from `XP_AMOUNTS`; hardcoding a number at a call site
 * is a bug, not a shortcut.
 */
export const XP_AMOUNTS = {
  habitComplete: 5,
  dayComplete: 10,
  waterTarget: 5,
  streak: { 7: 25, 30: 100, 100: 250 },
  monthInBudget: 100,
} as const;

/** Habit streak lengths that earn a one-time milestone award, in ascending order. */
export const STREAK_MILESTONES = [7, 30, 100] as const;

/**
 * `key` is the dedupe key for the ledger's unique `{ userId, key }` index. Must
 * be stable for the same real-world event — same habit, same local day, same
 * key, always — so a replayed tap collides and becomes a no-op rather than a
 * double award.
 */
export type XpAward = { key: string; amount: number };

export interface HabitLogInput {
  habitId: string;
  localDate: LocalDate;
  complete: boolean;
  /** The streak as recomputed after this log, not the pre-log value. */
  currentStreak: number;
  /** Habits scheduled for `localDate`. Zero means nothing was due — no day bonus is possible. */
  scheduledCount: number;
  /** Habits completed for `localDate`, including this one. */
  completedCount: number;
}

/**
 * What a single habit log earns: the habit itself, the day bonus if every
 * scheduled habit is now done, and any streak milestone reached.
 *
 * Milestones are offered for every value at or below `currentStreak`, not on
 * exact equality. `recomputeStreak` derives the streak from logs, so a streak
 * can arrive already past a milestone — a backfilled log, a corrected date —
 * and checking for exact equality would silently miss that award forever.
 * Offering every milestone at or below is free: the ledger's unique index makes
 * re-offering an already-granted one a no-op.
 */
export function awardsForHabitLog(input: HabitLogInput): XpAward[] {
  if (!input.complete) return [];

  const awards: XpAward[] = [
    { key: `habit:${input.habitId}:${input.localDate}`, amount: XP_AMOUNTS.habitComplete },
  ];

  if (input.scheduledCount > 0 && input.completedCount >= input.scheduledCount) {
    awards.push({ key: `day:${input.localDate}`, amount: XP_AMOUNTS.dayComplete });
  }

  for (const milestone of STREAK_MILESTONES) {
    if (input.currentStreak >= milestone) {
      awards.push({
        key: `streak:${input.habitId}:${milestone}`,
        amount: XP_AMOUNTS.streak[milestone],
      });
    }
  }

  return awards;
}

export interface WaterEntryInput {
  localDate: LocalDate;
  totalMl: number;
  targetMl: number;
}

/**
 * The water target award, once per day, keyed on the day alone (not the entry)
 * so that reaching it twice — or recomputing the day's total from scratch —
 * collides on the same key rather than paying out again.
 */
export function awardsForWaterEntry(input: WaterEntryInput): XpAward[] {
  if (input.totalMl < input.targetMl) return [];
  return [{ key: `water:${input.localDate}`, amount: XP_AMOUNTS.waterTarget }];
}

export interface MonthInput {
  /** `YYYY-MM`, the month that just closed. */
  month: string;
  spentMinor: number;
  /** `null` when the user has never set a budget — no award and no penalty either way. */
  budgetMinor: number | null;
}

/**
 * The month-closed-within-budget award. Spending over budget earns nothing —
 * never a deduction, and never a message about it — and no budget set earns
 * nothing either, since there was no target to have honoured.
 */
export function awardForMonth(input: MonthInput): XpAward | null {
  if (input.budgetMinor === null) return null;
  if (input.spentMinor > input.budgetMinor) return null;
  return { key: `budget:${input.month}`, amount: XP_AMOUNTS.monthInBudget };
}
