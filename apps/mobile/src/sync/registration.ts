import type { SourcePrefs } from './sourcePrefs.js';

/**
 * Whether the background task should exist at all.
 *
 * Unregistering when there is nothing to do matters: a registered task that wakes to do
 * nothing still spends the OS's limited background budget, and the OS responds by waking
 * the app less often when there IS something to do.
 */
export function shouldRegister(input: { signedIn: boolean; prefs: SourcePrefs }): boolean {
  const { signedIn, prefs } = input;
  return signedIn && prefs.background && (prefs.health || prefs.calendar);
}
