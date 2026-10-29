import { addLocalDays, type LocalDate } from '@synitheia/shared';
import type { HabitHistory } from '../api/types.js';

export type DayState = 'done' | 'some' | 'none';

export interface RecentDay {
  localDate: LocalDate;
  state: DayState;
}

/**
 * The seven days ending today, oldest first, for the dots under a habit card.
 *
 * Today's state comes from the live habit rather than the history, which was loaded
 * once and does not see a tick made since — the dot must change with the check mark.
 */
export function lastSeven(
  logs: HabitHistory['logs'],
  today: LocalDate,
  live: { todayComplete: boolean; todayCount: number },
): RecentDay[] {
  const byDate = new Map(logs.map((l) => [l.localDate, l]));

  return Array.from({ length: 7 }, (_, i) => {
    const localDate = addLocalDays(today, i - 6);

    if (localDate === today) {
      return {
        localDate,
        state: live.todayComplete ? 'done' : live.todayCount > 0 ? 'some' : 'none',
      };
    }

    const log = byDate.get(localDate);
    return {
      localDate,
      state: log?.complete ? 'done' : (log?.count ?? 0) > 0 ? 'some' : 'none',
    };
  });
}
