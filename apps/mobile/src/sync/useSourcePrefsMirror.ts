import { useEffect } from 'react';
import { syncBackgroundRegistration } from './backgroundTask.js';
import { writeSourcePrefs } from './sourcePrefs.js';

/**
 * Keep the local prefs mirror, and the task's registration, in step with the server's
 * list of sources.
 *
 * Driven by the `/data-sources` query rather than by the toggle handler, so it also
 * covers a user who connected Health before this feature existed, and one who changed a
 * source on another device.
 */
export function useSourcePrefsMirror(
  items: { source: string; status: string }[] | undefined,
): void {
  const connected = (source: string): boolean | undefined =>
    items?.some((s) => s.source === source && s.status === 'connected');

  const health = connected('health');
  const calendar = connected('calendar');

  useEffect(() => {
    // Undefined means the list has not loaded. Writing `false` then would unregister the
    // task on every cold start until the request came back.
    if (health === undefined || calendar === undefined) return;

    void writeSourcePrefs({ health, calendar }).then(() => syncBackgroundRegistration());
  }, [health, calendar]);
}
