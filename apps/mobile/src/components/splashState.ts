import { useSyncExternalStore } from 'react';

/**
 * Whether the launch splash has gone. Today's ring waits for it: it filled behind the
 * splash, so on a cold start the one animation that sums up the day was never seen.
 * Once per app run; it never goes back to false.
 */
let done = false;
const listeners = new Set<() => void>();

export function markSplashDone(): void {
  if (done) return;
  done = true;
  listeners.forEach((listener) => listener());
}

export function useSplashDone(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => done,
  );
}
