import { asMinor, formatMoney, formatVolume, type TodayResponse } from '@synitheia/shared';

type DayFacts = Pick<TodayResponse, 'habits' | 'expenses' | 'water'>;

/** "2 of 3 habits done", "All 3 habits done", "3 habits to do", "1 habit to do". */
function habitsPart(habits: DayFacts['habits']): string | null {
  const total = habits.length;
  if (total === 0) return null;
  const done = habits.filter((h) => h.todayComplete).length;
  if (done === 0) return `${total} ${total === 1 ? 'habit' : 'habits'} to do`;
  if (done === total) return total === 1 ? 'Habit done' : `All ${total} habits done`;
  return `${done} of ${total} habits done`;
}

/**
 * The line under Today's greeting: what the day holds so far, in facts. It replaced
 * "Keep the momentum", which said the same thing every day and nothing about this one.
 * Only the parts that have something in them.
 */
export function dayLine(day: DayFacts, currency: string): string {
  const parts = [
    habitsPart(day.habits),
    day.expenses.count > 0
      ? `${formatMoney(asMinor(day.expenses.totalMinor), currency)} spent`
      : null,
    day.water.totalMl > 0 ? `${formatVolume(day.water.totalMl)} water` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' · ') : 'Nothing logged yet today.';
}
