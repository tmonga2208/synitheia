import * as Notifications from 'expo-notifications';
import type { TodayResponse } from '@synitheia/shared';
import { hasSession, request } from '../api/client.js';
import type { ListResponse, WireReminder } from '../api/types.js';
import { planNotifications, type PlannedNotification } from './plan.js';

/**
 * Puts the reminder plan (plan.ts) on the phone, and keeps it current.
 *
 * Reminders are dated notifications two weeks ahead, so they are refreshed whenever the app
 * learns something: it opens, something is logged, a reminder changes, or the background
 * sync runs. Each refresh replaces every reminder the app set, and nothing else.
 */

export type RefreshOutcome = 'scheduled' | 'no-permission' | 'signed-out' | 'failed';

/** Wait this long after the last change, so a burst of taps refreshes once. */
const DEBOUNCE_MS = 1500;

/** Set by the auth store when it knows the user; a background launch asks the server. */
let knownCurrency: string | null = null;

export function setReminderCurrency(code: string): void {
  knownCurrency = code;
}

/**
 * Whether a scheduled notification is one of this app's reminders.
 *
 * Builds before 2026-10-25 set repeating reminders carrying only `reminderId` (Reminders
 * screen) or `habitId` (new habit). They count as ours, so the first refresh on a new
 * build replaces them instead of leaving them firing beside the new ones. Suggestion
 * notifications carry `suggestionId` and are left alone.
 */
function isOurs(request: Notifications.NotificationRequest): boolean {
  const data = request.content.data as Record<string, unknown> | null | undefined;
  if (!data) return false;
  if (data.source === 'synitheia-reminder') return true;
  return data.source === undefined && (typeof data.reminderId === 'string' || typeof data.habitId === 'string');
}

async function cancelOurs(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(isOurs)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

export async function applyPlan(plan: PlannedNotification[]): Promise<void> {
  await cancelOurs();

  for (const item of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: item.identifier,
      content: { title: item.title, body: item.body, data: item.data },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: item.date },
    });
  }
}

async function currencyFor(background: boolean): Promise<string> {
  if (knownCurrency) return knownCurrency;
  const me = await request<{ user: { currency: string } }>('/me', { background });
  knownCurrency = me.user.currency;
  return knownCurrency;
}

async function runOnce(background: boolean): Promise<RefreshOutcome> {
  if (!(await hasSession())) return 'signed-out';

  // Never prompts: asking is for a screen the user is looking at (permission.ts).
  if (!(await Notifications.getPermissionsAsync()).granted) return 'no-permission';

  let reminders: ListResponse<WireReminder>;
  let today: TodayResponse;
  let currency: string;
  try {
    [reminders, today, currency] = await Promise.all([
      request<ListResponse<WireReminder>>('/reminders', { background }),
      request<TodayResponse>('/today', { background }),
      currencyFor(background),
    ]);
  } catch {
    // Without both lists a plan would drop reminders. The ones already set stay.
    return 'failed';
  }

  await applyPlan(
    planNotifications({ now: new Date(), reminders: reminders.items, today, currency }),
  );
  return 'scheduled';
}

let running: Promise<RefreshOutcome> | null = null;
let runAgain = false;
let runAgainInBackground = true;

/**
 * Re-plan and re-schedule. One run at a time: a refresh asked for during a run happens
 * once more after it, so the last change is never planned from stale numbers.
 */
export function refreshReminders(options: { background?: boolean } = {}): Promise<RefreshOutcome> {
  const background = options.background === true;

  if (running) {
    runAgain = true;
    // A queued run counts as foreground if anyone in the queue is looking.
    runAgainInBackground &&= background;
    return running;
  }

  running = (async () => {
    let outcome = await runOnce(background).catch((): RefreshOutcome => 'failed');
    while (runAgain) {
      const queuedInBackground = runAgainInBackground;
      runAgain = false;
      runAgainInBackground = true;
      outcome = await runOnce(queuedInBackground).catch((): RefreshOutcome => 'failed');
    }
    return outcome;
  })().finally(() => {
    running = null;
  });

  return running;
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** Ask for a refresh soon. Called after every successful change; never throws. */
export function requestReminderRefresh(): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void refreshReminders();
  }, DEBOUNCE_MS);
}

/** Cancel every reminder the app set: signing out must not leave them firing. */
export async function clearReminders(): Promise<void> {
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  knownCurrency = null;
  await cancelOurs();
}
