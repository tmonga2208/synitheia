import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { runHealthSync } from '../sync/runHealthSync.js';
import { isAvailable, isSupported, requestPermissions } from './healthkit.js';

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
    if (inFlight.current) return;

    inFlight.current = true;
    try {
      const result = await runHealthSync();
      if (!result.ok || result.skipped) return;

      // Steps may have completed a step habit, which moves the ring and the timeline.
      await queryClient.invalidateQueries({ queryKey: ['today'] });
      await queryClient.invalidateQueries({ queryKey: ['habits'] });
      await queryClient.invalidateQueries({ queryKey: ['health-body'] });
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
/**
 * Why a connect attempt ended the way it did.
 *
 * `unavailable`    the platform has no health store to talk to (Android today, an iPad).
 * `unauthorized`   the store IS there but the request failed. On a real device this is
 *                  almost always the HealthKit entitlement being stripped at signing —
 *                  Apple only grants it to a PAID developer account, so a free-Apple-ID
 *                  build (which is fine everywhere else) simply cannot read Health. It also
 *                  covers the user tapping "Don't Allow". Either way, retrying alone won't
 *                  help, so the message has to say what actually needs to change.
 */
export type HealthConnectResult = 'connected' | 'unavailable' | 'unauthorized';

export async function connectHealth(): Promise<HealthConnectResult> {
  if (!isSupported()) return 'unavailable';
  if (!(await isAvailable())) return 'unavailable';
  return (await requestPermissions()) ? 'connected' : 'unauthorized';
}
