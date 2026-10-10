import { syncResultSchema, type SyncSuggestion } from '@synitheia/shared';
import { api } from '../api/client.js';
import { isSupported, readHealth } from '../health/healthkit.js';

const WINDOW_DAYS = 7;

export interface SyncRunResult {
  /** False only when something was attempted and failed. */
  ok: boolean;
  /** True when there was nothing to send. Not a failure. */
  skipped: boolean;
  suggestions: SyncSuggestion[];
}

const SKIPPED: SyncRunResult = { ok: true, skipped: true, suggestions: [] };
const FAILED: SyncRunResult = { ok: false, skipped: false, suggestions: [] };

/**
 * One Apple Health sync. No React, no query client, never throws — the same function
 * serves the foreground hook and the background task.
 *
 * A failure is reported, not raised. Health is an assist the user did not invoke; the
 * caller decides whether a failed assist is worth telling anyone about, and the answer
 * has so far always been no.
 */
export async function runHealthSync(
  options: { background?: boolean } = {},
): Promise<SyncRunResult> {
  if (!isSupported()) return SKIPPED;

  try {
    const payload = await readHealth(WINDOW_DAYS);
    if (!payload) return SKIPPED;

    const hasAnything =
      payload.days.some(
        (d) => d.steps != null || d.activeEnergyKcal != null || d.sleepMinutes != null,
      ) || Object.keys(payload.body ?? {}).length > 0;

    // iOS never says "permission denied" for reads, and returns nothing while the phone
    // is locked. Posting an empty week would blank out real data with nulls.
    if (!hasAnything) return SKIPPED;

    const response = await api.post<unknown>('/health/sync', payload, {
      background: options.background === true,
    });

    // The sync itself succeeded. A response we cannot read costs a notification, no more.
    const parsed = syncResultSchema.safeParse(response);
    return { ok: true, skipped: false, suggestions: parsed.success ? parsed.data.suggestions : [] };
  } catch {
    return FAILED;
  }
}
