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
import { tickMessage } from './tickCopy.js';

type TodayHabit = TodayResponse['habits'][number];

const TODAY_KEY = ['today'] as const;

interface Step {
  habit: TodayHabit;
  /** +1 adds one step of the habit's measure; -1 takes one back. */
  direction: 1 | -1;
  /** The day the tap was made on, so a tick sent after midnight still counts for it. */
  localDate: LocalDate;
}

/** Today on the user's calendar, the way the server counts their days. */
function userToday(): LocalDate {
  const zone =
    useAuth.getState().user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return todayLocalDate(zone);
}

/**
 * Ticking a habit, and taking a tick back, the same way on every screen that lists habits.
 *
 * Optimistic, because a checkbox that waits on a round trip feels broken: the card moves
 * at once and rolls back if the server refuses (the failure is reported by the mutation
 * cache in app/_layout.tsx). A tick is saved straight away, since the streak and XP hang on
 * it, and its toast offers Undo, which sends one step back. Tapping a ticked habit does
 * the same.
 */
export function useHabitLog(): { log: (habit: TodayHabit) => void; unlog: (habit: TodayHabit) => void } {
  const queryClient = useQueryClient();

  const step = useMutation({
    meta: { failed: 'Couldn’t log that habit' },
    mutationFn: ({ habit, direction, localDate }: Step) =>
      // One tap moves one STEP of the habit's measure, not one unit: a step goal that moved
      // 1 at a time would need 8,000 taps. Offline, it waits on the phone (src/offline).
      api.offline.post<unknown>(
        `/habits/${habit.id}/log`,
        { localDate, increment: direction * HABIT_MEASURES[measureOf(habit)].step },
        habit.name,
      ),

    onMutate: async ({ habit, direction }: Step) => {
      await queryClient.cancelQueries({ queryKey: TODAY_KEY });
      const previous = queryClient.getQueryData<TodayResponse>(TODAY_KEY);

      queryClient.setQueryData<TodayResponse>(TODAY_KEY, (current) =>
        current
          ? {
              ...current,
              habits: current.habits.map((h) => {
                if (h.id !== habit.id) return h;
                const todayCount = Math.max(
                  0,
                  h.todayCount + direction * HABIT_MEASURES[measureOf(h)].step,
                );
                return { ...h, todayCount, todayComplete: todayCount >= h.targetCount };
              }),
            }
          : current,
      );

      return { previous };
    },

    onSuccess: (_result, { habit, direction, localDate }) => {
      if (direction === -1) return;
      const count = habit.todayCount + HABIT_MEASURES[measureOf(habit)].step;
      showToast({
        message: tickMessage(habit, count),
        action: {
          label: 'Undo',
          // The habit as it now is, so the step back lands where the tick left it.
          onPress: () =>
            step.mutate({ habit: { ...habit, todayCount: count }, direction: -1, localDate }),
        },
      });
    },

    onError: (_error, _step, context) => {
      if (context?.previous) queryClient.setQueryData(TODAY_KEY, context.previous);
    },

    // Still on the phone: the card already shows it, and the sync refetches when it lands.
    onSettled: (result) => {
      if (isQueued(result)) return;
      void queryClient.invalidateQueries({ queryKey: TODAY_KEY });
      // A log recomputes the streak, which the habit lists and history render.
      void queryClient.invalidateQueries({ queryKey: ['habits'] });
      void queryClient.invalidateQueries({ queryKey: ['habit-history'] });
    },
  });

  return {
    log: (habit) => step.mutate({ habit, direction: 1, localDate: userToday() }),
    unlog: (habit) => step.mutate({ habit, direction: -1, localDate: userToday() }),
  };
}
