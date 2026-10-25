import type { ReminderRoute } from './plan.js';

/** Only the screens the planner sends reminders to. A notification cannot name another. */
const KNOWN: readonly ReminderRoute[] = ['/', '/water', '/nutrition', '/expenses/new'];

/**
 * Where a tapped notification should open, or null to leave the app where it was.
 *
 * Reminders carry the screen where the thing they are about gets done (plan.ts);
 * suggestions open Today, where their card is waiting to be confirmed.
 */
export function routeForNotification(data: unknown): ReminderRoute | null {
  if (typeof data !== 'object' || data === null) return null;
  const fields = data as Record<string, unknown>;

  if (typeof fields.suggestionId === 'string') return '/';

  if (fields.source === 'synitheia-reminder') {
    const route = KNOWN.find((known) => known === fields.route);
    return route ?? null;
  }

  return null;
}
