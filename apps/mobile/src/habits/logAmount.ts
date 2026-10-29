import { HABIT_MEASURES, measureOf, type HabitMeasure, type TodayResponse } from '@synitheia/shared';

type TodayHabit = TodayResponse['habits'][number];

/** One-tap amounts on the log sheet, sized for how each measure is usually done. */
export function quickAmounts(measure: HabitMeasure): number[] {
  if (measure === 'steps') return [500, 1000, 2000];
  if (measure === 'duration') return [5, 15, 30];
  return [1, 2, 5];
}

export interface AmountScale {
  /** The slider's resolution: a minute, a hundred steps, one of anything else. */
  step: number;
  max: number;
}

/**
 * The slider's range: half again past the target, and a quarter past whatever is already
 * logged. The sheet resizes it after every change, so dragging to the end and letting go
 * leaves more room each time: a long day is never out of reach.
 */
export function amountScale(habit: TodayHabit): AmountScale {
  const measure = measureOf(habit);
  const step = measure === 'steps' ? 100 : 1;
  const reach = Math.max(habit.targetCount * 1.5, habit.todayCount * 1.25 + HABIT_MEASURES[measure].step * 4);
  return { step, max: Math.ceil(reach / step) * step };
}

/** A chip or a step added to the amount: never below zero, and no upper limit. */
export function addAmount(value: number, amount: number): number {
  return Math.max(0, value + amount);
}

/** A typed amount: digits only, grouping commas allowed. Anything else is not an amount. */
export function parseAmount(text: string): number | null {
  const digits = text.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

export function snapAmount(value: number, scale: AmountScale): number {
  return Math.min(scale.max, Math.max(0, Math.round(value / scale.step) * scale.step));
}

/** Today with one habit's count changed: the optimistic step, and its rollback. */
export function withHabitCount(
  today: TodayResponse,
  habitId: string,
  update: (count: number) => number,
): TodayResponse {
  return {
    ...today,
    habits: today.habits.map((h) => {
      if (h.id !== habitId) return h;
      const todayCount = Math.max(0, update(h.todayCount));
      return { ...h, todayCount, todayComplete: todayCount >= h.targetCount };
    }),
  };
}
