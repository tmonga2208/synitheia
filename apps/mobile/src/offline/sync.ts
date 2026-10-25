import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { showToast } from '../feedback/toast.js';
import { drainOutbox, useOutbox, type DrainResult } from './outbox.js';
import { replayChange } from './replay.js';

/**
 * Sending the changes made offline, and saying how it went.
 *
 * Runs on the way back online, before queries resume (src/api/connectivity.ts), and at a
 * launch with changes still waiting. Afterwards every screen refetches, so what the server
 * now holds is what is shown, refused changes undone with it.
 */

/** How long a stuck queue waits before trying again while online; the last one repeats. */
const RETRY_MS = [15_000, 30_000, 60_000, 120_000, 300_000];

let running: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;

/** What one sync says. One toast at a time, so one message for the lot. */
export function syncMessage(
  result: DrainResult,
): { message: string; tone: 'neutral' | 'error' } | null {
  const [first, ...more] = result.refused;
  if (first) {
    const label = first.change.label;
    const message =
      more.length === 0
        ? `Couldn’t sync “${label}”. ${first.reason}`
        : `Couldn’t sync ${result.refused.length} changes made offline, including “${label}”.`;
    return { message, tone: 'error' };
  }
  if (result.sent === 0) return null;
  return {
    message: `Synced ${result.sent} ${result.sent === 1 ? 'change' : 'changes'}`,
    tone: 'neutral',
  };
}

export function syncNow(client: QueryClient): Promise<void> {
  running ??= (async () => {
    const result = await drainOutbox(replayChange);
    // Not awaited: while coming back online the refetches wait for it, and it waits for this.
    if (result.sent > 0 || result.refused.length > 0) void client.invalidateQueries();
    const said = syncMessage(result);
    if (said) showToast(said);
    tryAgainLater(client);
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * A queue stopped by the server (busy, restarting) while the connection is fine is not
 * sent by coming back online, because the app never went offline. It is tried again on a
 * timer, waiting longer each time, until it empties.
 */
function tryAgainLater(client: QueryClient): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;

  if (useOutbox.getState().items.length === 0) {
    retries = 0;
    return;
  }

  const delay = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
  retries += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    // Offline, coming back online sends them.
    if (onlineManager.isOnline()) void syncNow(client);
  }, delay);
}
