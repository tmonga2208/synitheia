import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatVolume } from '@synitheia/shared';
import { api, isQueued } from '../api/client.js';
import { newObjectId } from '../offline/ids.js';
import { WATER_KEY, hideGlass, refetchWater, showGlass } from './waterCache.js';

interface Glass {
  id: string;
  amountMl: number;
  /** When it was tapped: a glass sent after midnight still counts for the day it was drunk. */
  loggedAt: string;
}

/**
 * Logging a glass of water, the same way from the Trackers tile and the water screen.
 *
 * The glass shows at once, with its final id, so it can be removed before it reaches the
 * server. Offline it waits on the phone and is sent on the way back online; if the server
 * refuses it, it leaves the screen and the failure is reported (app/_layout.tsx).
 */
export function useAddWater(): (amountMl: number) => void {
  const queryClient = useQueryClient();

  const add = useMutation({
    meta: { failed: 'Couldn’t log water' },
    mutationFn: ({ id, amountMl, loggedAt }: Glass) =>
      api.offline.post<unknown>(
        '/water',
        { id, amountMl, loggedAt },
        `${formatVolume(amountMl)} of water`,
      ),

    onMutate: async ({ id, amountMl, loggedAt }: Glass) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: WATER_KEY }),
        queryClient.cancelQueries({ queryKey: ['today'] }),
      ]);
      showGlass(queryClient, { _id: id, amountMl, loggedAt });
    },

    onError: (_error, { id, amountMl }) => {
      hideGlass(queryClient, { _id: id, amountMl, loggedAt: '' });
    },

    // Still on the phone: the screen already shows it, and the sync refetches when it lands.
    onSettled: (result) => {
      if (!isQueued(result)) refetchWater(queryClient);
    },
  });

  return (amountMl: number) =>
    add.mutate({ id: newObjectId(), amountMl, loggedAt: new Date().toISOString() });
}
