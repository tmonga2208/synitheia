import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { isSupported, readHealth, requestPermissions } from './healthkit.js';

/**
 * Keep Apple Health and Synítheia in step.
 *
 * Runs on foreground, not on a timer. Health only changes while the phone is in the user's
 * pocket, and there is nothing to sync while the app is open and idle — a polling loop would
 * burn battery to re-read numbers that cannot have moved.
 *
 * A failure here is deliberately SILENT. Health is an assist, not a feature the user invoked;
 * a red banner because a step count could not be fetched would be the app complaining about
 * a job the user never asked it to do.
 */

const WINDOW_DAYS = 7;

/**
 * `enabled` gates the AUTOMATIC sync only — the returned `sync()` always runs.
 *
 * The distinction matters: the privacy screen calls `sync()` by hand the instant the user
 * connects Health, at which point the server-side consent row exists but this hook's
 * `enabled` prop has not re-rendered yet. Gating the manual call on it would mean turning
 * Health on pulled nothing, and the user would see an empty week and assume it was broken.
 */
export function useHealthSync(enabled: boolean): { sync: () => Promise<void> } {
  const queryClient = useQueryClient();

  // Guards against two syncs overlapping — foregrounding twice quickly, or a manual sync
  // landing on top of the automatic one.
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (!isSupported() || inFlight.current) return;

    inFlight.current = true;
    try {
      const payload = await readHealth(WINDOW_DAYS);
      if (!payload) return;

      const hasAnything =
        payload.days.some(
          (d) => d.steps != null || d.activeEnergyKcal != null || d.sleepMinutes != null,
        ) || Object.keys(payload.body ?? {}).length > 0;

      // iOS never says "permission denied" for reads — it just returns nothing. Posting an
      // empty week would blank out real data with nulls, so an empty read is a no-op.
      if (!hasAnything) return;

      await api.post('/health/sync', payload);

      // Steps may have completed a step habit, which moves the ring and the timeline.
      await queryClient.invalidateQueries({ queryKey: ['today'] });
      await queryClient.invalidateQueries({ queryKey: ['habits'] });
      await queryClient.invalidateQueries({ queryKey: ['health-body'] });
    } catch {
      /* An assist that failed. The user did not ask for this; do not interrupt them. */
    } finally {
      inFlight.current = false;
    }
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return;

    void sync();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });

    return () => subscription.remove();
  }, [enabled, sync]);

  return { sync };
}

/**
 * Turning the Health source on.
 *
 * Two grants, in order: iOS's, then ours. Asking iOS first means a user who declines the
 * system sheet never gets a "connected" row promising data we cannot read.
 */
export async function connectHealth(): Promise<boolean> {
  if (!isSupported()) return false;
  return requestPermissions();
}
