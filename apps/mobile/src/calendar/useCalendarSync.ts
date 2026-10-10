import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { runCalendarSync } from '../sync/runCalendarSync.js';
import { isSupported, requestPermissions } from './calendar.js';

/**
 * Why a connect attempt ended the way it did — the same three-way result Health uses, so
 * Connected Context can give one honest message per outcome.
 *
 * Unlike Health, `unauthorized` here is almost always a plain "Don't Allow": the calendar
 * needs no special entitlement, so a free-Apple-ID build reads it fine.
 */
export type CalendarConnectResult = 'connected' | 'unavailable' | 'unauthorized';

export async function connectCalendar(): Promise<CalendarConnectResult> {
  if (!isSupported()) return 'unavailable';
  return (await requestPermissions()) ? 'connected' : 'unauthorized';
}

/**
 * Keep the device calendar and Synítheia in step.
 *
 * `enabled` gates the AUTOMATIC foreground sync only — the returned `sync()` always runs,
 * for the same reason as `useHealthSync`: Connected Context calls it by hand the instant
 * the user connects the source, before any `enabled` prop has re-rendered.
 */
export function useCalendarSync(enabled = false): { sync: () => Promise<void> } {
  const queryClient = useQueryClient();
  // Guarded against overlap so a fast double-tap on the source doesn't fire two syncs
  // that race each other's writes.
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await runCalendarSync();
      if (result.ok && !result.skipped) {
        await queryClient.invalidateQueries({ queryKey: ['today'] });
      }
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
