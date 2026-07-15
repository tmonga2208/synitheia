import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';
import { asLocalDate, type CalendarEventInput } from '@synitheia/shared';

/**
 * The device calendar, read on the device.
 *
 * Read-only, always: only `requestCalendarPermissionsAsync` is ever called, never a write
 * API, so the app is structurally incapable of changing the user's calendar. Events leave
 * the phone only through our /calendar/sync, and only once the user has switched Calendar on
 * in Connected Context.
 *
 * Both platforms have a calendar, so this — unlike HealthKit — is not iOS-only.
 */

export function isSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function requestPermissions(): Promise<boolean> {
  try {
    const { granted } = await Calendar.requestCalendarPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

/** The local calendar day of an instant, in the device's own zone — the day the app means. */
function localDateOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Read events from `daysBack` ago through `daysAhead` from now, across every calendar.
 *
 * A window, re-read whole each time, for the same reason Health is: a meeting moves, a new
 * one is added, yesterday gets edited. The server dedupes on the device event id, so
 * re-sending the window is free and always correct.
 */
export async function readCalendar(
  daysBack = 7,
  daysAhead = 1,
): Promise<CalendarEventInput[]> {
  if (!isSupported()) return [];

  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    if (calendars.length === 0) return [];

    const start = new Date();
    start.setDate(start.getDate() - daysBack);
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setDate(end.getDate() + daysAhead);
    end.setHours(23, 59, 59, 999);

    const events = await Calendar.getEventsAsync(
      calendars.map((c) => c.id),
      start,
      end,
    );

    return events.map((event) => {
      const startsAt = new Date(event.startDate);
      const endsAt = new Date(event.endDate);

      return {
        externalId: event.id,
        // A titleless event stays empty; the server shows it as "Busy" rather than guessing.
        title: (event.title ?? '').slice(0, 300),
        startsAt,
        endsAt,
        isAllDay: Boolean(event.allDay),
        localDate: asLocalDate(localDateOf(startsAt)),
      } satisfies CalendarEventInput;
    });
  } catch {
    return [];
  }
}
