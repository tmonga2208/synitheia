import { formatHabitProgress, type HabitMeasure } from '@synitheia/shared';

/** What a habit tap did, for the toast that offers to undo it: "Reading done". */
export function tickMessage(
  habit: { name: string; measure?: HabitMeasure | null; targetCount: number; unit?: string | null },
  count: number,
): string {
  if (count >= habit.targetCount) return `${habit.name} done`;
  return `${habit.name}: ${formatHabitProgress(habit, count)}`;
}
