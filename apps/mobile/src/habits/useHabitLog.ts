import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  HABIT_MEASURES,
  measureOf,
  todayLocalDate,
  type LocalDate,
  type TodayResponse,
} from '@synitheia/shared';
import { api, isQueued } from '../api/client.js';
import { showToast } from '../feedback/toast.js';
import { useAuth } from '../store/auth.js';
import { withHabitCount } from './logAmount.js';
import { tickMessage } from './tickCopy.js';

type TodayHabit = TodayResponse['habits'][number];

const TODAY_KEY = ['today'] as const;
const LOG_KEY = ['habit-log'] as const;

type Change =
  /** +1 adds one step of the habit's measure; -1 takes one back. */
  | { habit: TodayHabit; kind: 'step'; direction: 1 | -1; localDate: LocalDate }
  /** An exact total for the day, from the log sheet. */
  | { habit: TodayHabit; kind: 'set'; count: number; localDate: LocalDate };

/** Today on the user's calendar, the way the server counts their days. */
function userToday(): LocalDate {
  const zone =
    useAuth.getState().user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return todayLocalDate(zone);
}

function stepOf(habit: TodayHabit): number {
  return HABIT_MEASURES[measureOf(habit)].step;
}

/**
 * Ticking a habit, taking a tick back, and setting a day's exact amount, the same way on
 * every screen that lists habits.
 *
 * Optimistic, because a checkbox that waits on a round trip feels broken. Quick taps overlap,
 * so each change undoes only its own effect if refused, and Today is reloaded once the last
 * change in a burst has landed: reloading after every tap showed the screen jumping back
 * while later taps were still on their way.
 */
export function useHabitLog(): {
  log: (habit: TodayHabit) => void;
  unlog: (habit: TodayHabit) => void;
  setCount: (habit: TodayHabit, count: number) => void;
} {
  const queryClient = useQueryClient();

  const change = useMutation({
    mutationKey: LOG_KEY,
    meta: { failed: 'Couldn’t log that habit' },
    mutationFn: (c: Change) =>
      api.offline.post<unknown>(
        `/habits/${c.habit.id}/log`,
        c.kind === 'set'
          ? { localDate: c.localDate, count: c.count }
          : { localDate: c.localDate, increment: c.direction * stepOf(c.habit) },
        c.habit.name,
      ),

    onMutate: async (c: Change) => {
      await queryClient.cancelQueries({ queryKey: TODAY_KEY });
      const current = queryClient.getQueryData<TodayResponse>(TODAY_KEY);
      const before = current?.habits.find((h) => h.id === c.habit.id)?.todayCount ?? c.habit.todayCount;
      const after = c.kind === 'set' ? c.count : Math.max(0, before + c.direction * stepOf(c.habit));
      if (current) queryClient.setQueryData(TODAY_KEY, withHabitCount(current, c.habit.id, () => after));
      return { delta: after - before, after };
    },

    onSuccess: (_result, c, context) => {
      if (c.kind === 'step' && c.direction === -1) return;
      const count = context?.after ?? c.habit.todayCount;
      showToast({
        message: tickMessage(c.habit, count),
        action: {
          label: 'Undo',
          onPress: () =>
            change.mutate(
              c.kind === 'set'
                ? { habit: c.habit, kind: 'set', count: c.habit.todayCount, localDate: c.localDate }
                : { habit: { ...c.habit, todayCount: count }, kind: 'step', direction: -1, localDate: c.localDate },
            ),
        },
      });
    },

    // Only this change's own effect comes off; other taps still in flight keep theirs.
    onError: (_error, c, context) => {
      const current = queryClient.getQueryData<TodayResponse>(TODAY_KEY);
      if (current && context) {
        queryClient.setQueryData(TODAY_KEY, withHabitCount(current, c.habit.id, (n) => n - context.delta));
      }
    },

    // Still on the phone: the card already shows it, and the sync refetches when it lands.
    onSettled: (result) => {
      if (isQueued(result)) return;
      // This change still counts as running here; reload only when it is the last.
      if (queryClient.isMutating({ mutationKey: LOG_KEY }) > 1) return;
      void queryClient.invalidateQueries({ queryKey: TODAY_KEY });
      // A log recomputes the streak, which the habit lists and history render.
      void queryClient.invalidateQueries({ queryKey: ['habits'] });
      void queryClient.invalidateQueries({ queryKey: ['habit-history'] });
    },
  });

  return {
    log: (habit) => change.mutate({ habit, kind: 'step', direction: 1, localDate: userToday() }),
    unlog: (habit) => change.mutate({ habit, kind: 'step', direction: -1, localDate: userToday() }),
    setCount: (habit, count) => change.mutate({ habit, kind: 'set', count, localDate: userToday() }),
  };
}
