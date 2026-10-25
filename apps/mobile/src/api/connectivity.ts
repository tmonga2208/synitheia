import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

/**
 * Whether the app can reach its server, learned from its own requests.
 *
 * React Query pauses queries while offline and refetches the moment it is back, but only if
 * something tells it. Nothing did, so a screen loaded on a dead connection stayed on its
 * error until pulled to refresh. There is no network-status module in this app (native
 * modules are a liability here), and none is needed: a request that cannot connect says
 * the app is offline, and while offline the server's /health is checked every few seconds
 * until it answers.
 */

const CHECK_EVERY_MS = 5000;

let probe: (() => Promise<boolean>) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function stopChecking(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Called by the API client when a request got no answer. */
export function noteNetworkFailure(): void {
  if (!onlineManager.isOnline()) return;
  onlineManager.setOnline(false);
  if (probe && !timer) timer = setInterval(() => void checkConnectivityNow(), CHECK_EVERY_MS);
}

/** Called by the API client when any request got an answer, even an error. */
export function noteNetworkSuccess(): void {
  stopChecking();
  if (!onlineManager.isOnline()) onlineManager.setOnline(true);
}

/** Check now, when offline: the app came back to the front, say. Never throws. */
export async function checkConnectivityNow(): Promise<void> {
  if (onlineManager.isOnline() || !probe) return;
  try {
    if (await probe()) noteNetworkSuccess();
  } catch {
    // Still offline; the next check will try again.
  }
}

/** Start listening. `check` resolves true when the server answers. Returns a stop. */
export function startConnectivity(check: () => Promise<boolean>): () => void {
  probe = check;
  return () => {
    stopChecking();
    probe = null;
  };
}

/** True while the app can reach its server, as far as it knows. */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  );
}
