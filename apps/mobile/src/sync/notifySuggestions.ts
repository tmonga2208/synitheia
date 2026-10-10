import * as Notifications from 'expo-notifications';
import type { SyncSuggestion } from '@synitheia/shared';
import { parseNotifyState, selectNotifiable } from './notifyPolicy.js';

const STATE_KEY = 'synitheia.notify-state';

/** Carried on the notification so a tap can be recognised as one of ours. */
export interface SuggestionNotificationData {
  suggestionId: string;
}

async function storage() {
  const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
  return AsyncStorage;
}

/**
 * Post local notifications for the suggestions the policy allows.
 *
 * Local, not push: the phone already has the suggestion in hand, so there is no server
 * to round-trip through and no token to register.
 *
 * Never throws, and never asks for permission. A background task cannot show a permission
 * sheet, and a suggestion that fails to notify is still waiting in Today.
 */
export async function notifySuggestions(suggestions: readonly SyncSuggestion[]): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;

    const store = await storage();
    const state = parseNotifyState(await store.getItem(STATE_KEY));
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    const { toNotify, nextState } = selectNotifiable(suggestions, state, new Date(), timeZone);
    if (toNotify.length === 0) return;

    // State first. If the write succeeds and a notification then fails, the user misses
    // one nudge; the other order risks the same nudge twice.
    await store.setItem(STATE_KEY, JSON.stringify(nextState));

    for (const suggestion of toNotify) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: suggestion.title,
          body: 'Tap to confirm in Today.',
          data: { suggestionId: suggestion.id } satisfies SuggestionNotificationData,
        },
        // Null trigger: deliver now.
        trigger: null,
      });
    }
  } catch {
    // The suggestion is still in Today. Nothing here is worth failing a sync over.
  }
}
