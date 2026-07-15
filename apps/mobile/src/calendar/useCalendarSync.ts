import { useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import { isSupported, readCalendar, requestPermissions } from './calendar.js';

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
 * Push the calendar window to the server. Guarded against overlap so a fast double-tap on
 * the source doesn't fire two syncs that race each other's writes.
 */
export function useCalendarSync(): { sync: () => Promise<void> } {
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (!isSupported() || inFlight.current) return;
    inFlight.current = true;
    try {
      const events = await readCalendar();
      // Nothing to send is a valid outcome — an empty calendar is not an error.
      await api.post('/calendar/sync', { events });
    } catch {
      // A sync failure is not worth interrupting the user; the next one re-reads the whole
      // window anyway, so a missed push is self-healing.
    } finally {
      inFlight.current = false;
    }
  }, []);

  return { sync };
}
