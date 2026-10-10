import { syncResultSchema } from '@synitheia/shared';
import { api } from '../api/client.js';
import { isSupported, readCalendar } from '../calendar/calendar.js';
import type { SyncRunResult } from './runHealthSync.js';

/**
 * One calendar sync. Same contract as `runHealthSync`: no React, never throws.
 *
 * Unlike Health, an empty read IS sent. The server mirrors the whole window each time,
 * and "no events" is how a cancelled meeting stops appearing on the day.
 */
export async function runCalendarSync(
  options: { background?: boolean } = {},
): Promise<SyncRunResult> {
  if (!isSupported()) return { ok: true, skipped: true, suggestions: [] };

  try {
    const events = await readCalendar();
    const response = await api.post<unknown>(
      '/calendar/sync',
      { events },
      { background: options.background === true },
    );
    const parsed = syncResultSchema.safeParse(response);
    return { ok: true, skipped: false, suggestions: parsed.success ? parsed.data.suggestions : [] };
  } catch {
    return { ok: false, skipped: false, suggestions: [] };
  }
}
