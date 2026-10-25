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

export interface ConnectivityOptions {
  /**
   * Runs on the way back online, before paused queries resume: sending the changes made
   * offline, so the screens refetch data that already has them.
   */
  beforeOnline?: () => Promise<void>;
}

let probe: (() => Promise<boolean>) | null = null;
let beforeOnline: (() => Promise<void>) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
/** The way back online while beforeOnline runs. One at a time. */
let comingBack: Promise<void> | null = null;
/** A request failed while coming back: the connection dropped again. */
let droppedMeanwhile = false;

function startChecking(): void {
  if (probe && !timer) timer = setInterval(() => void checkConnectivityNow(), CHECK_EVERY_MS);
}

function stopChecking(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Back online, after beforeOnline has run. However many answers arrive meanwhile (the
 * changes being sent are answers too), it runs once and queries resume once, after it.
 */
function comeBack(): Promise<void> {
  stopChecking();
  if (onlineManager.isOnline()) return Promise.resolve();

  const run = beforeOnline;
  if (!run) {
    onlineManager.setOnline(true);
    return Promise.resolve();
  }

  comingBack ??= (async () => {
    droppedMeanwhile = false;
    try {
      await run();
    } catch {
      // Whatever went wrong there, queries must not stay paused over it.
    }
    comingBack = null;

    if (droppedMeanwhile) {
      droppedMeanwhile = false;
      startChecking();
      return;
    }
    onlineManager.setOnline(true);
  })();
  return comingBack;
}

/** Called by the API client when a request got no answer. */
export function noteNetworkFailure(): void {
  if (comingBack) {
    droppedMeanwhile = true;
    return;
  }
  if (!onlineManager.isOnline()) return;
  onlineManager.setOnline(false);
  startChecking();
}

/** Called by the API client when any request got an answer, even an error. */
export function noteNetworkSuccess(): void {
  void comeBack();
}

/** Check now, when offline: the app came back to the front, say. Never throws. */
export async function checkConnectivityNow(): Promise<void> {
  if (onlineManager.isOnline() || comingBack || !probe) return;
  try {
    if (await probe()) await comeBack();
  } catch {
    // Still offline; the next check will try again.
  }
}

/**
 * Hold queries until beforeOnline has run, then let them go: for a launch with changes
 * still waiting from last time, so the first data the screens fetch already has them.
 */
export function holdUntilSynced(): Promise<void> {
  if (comingBack) return comingBack;
  onlineManager.setOnline(false);
  return comeBack();
}

/** Start listening. `check` resolves true when the server answers. Returns a stop. */
export function startConnectivity(
  check: () => Promise<boolean>,
  options: ConnectivityOptions = {},
): () => void {
  probe = check;
  beforeOnline = options.beforeOnline ?? null;
  return () => {
    stopChecking();
    probe = null;
    beforeOnline = null;
  };
}

/** True while the app can reach its server, as far as it knows. */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  );
}
