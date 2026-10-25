import type { ConnectableSource } from '@synitheia/shared';
import type { DataSourceItem } from '../api/types.js';

/**
 * "Delete this source's data" on Connected Context: when to offer it and what to say.
 *
 * The server's DELETE /data-sources/:source/data removes the source's events from the
 * timeline (plus Health's daily records), turns the source off, and leaves everything the
 * user entered by hand. The words here have to match that exactly, including what it does
 * NOT remove, because a privacy control that overstates itself is worse than none.
 */

/**
 * Offered once a source has left something behind, whether or not it is still on. A source
 * that was switched off but still holds a month of history is the case this exists for. A
 * source that never synced has nothing to delete, and a button there would imply otherwise.
 * A sync sets `lastSyncedAt` even when it adds no events, and Health's daily records arrive
 * with that sync, so a synced source counts as having data.
 */
export function canForget(item: DataSourceItem): boolean {
  if (item.status === 'unavailable') return false;
  return item.eventCount > 0 || item.lastSyncedAt !== null;
}

function events(count: number): string {
  return `${count} ${count === 1 ? 'event' : 'events'}`;
}

/** What each source put on the timeline, in the words the user knows it by. */
const WHAT_IT_ADDED: Record<ConnectableSource, string> = {
  health: 'steps, sleep and workouts',
  calendar: 'your meetings',
  location: 'places you arrived at',
  weather: 'the weather for each day',
  notifications: 'notifications',
};

/**
 * What survives and what can come back. Health and Calendar are read from stores on the
 * phone that this does not touch, so turning them on again re-reads recent days from there.
 * Location and Weather are only ever sent as they happen, so nothing returns.
 */
function afterwards(source: ConnectableSource, healthAppName: string): string {
  if (source === 'health') {
    return `Step counts already filled into your habits stay, as does everything you entered yourself. ${healthAppName} keeps its own copy, so turning this on again brings back recent days from it.`;
  }
  if (source === 'calendar') {
    return 'Everything you entered yourself stays. Your calendar itself is not touched, so turning this on again brings back recent days from it.';
  }
  return 'Everything you entered yourself stays. Turning this on again starts from then; nothing deleted comes back.';
}

export function forgetConfirmation(
  item: DataSourceItem,
  healthAppName: string,
): { title: string; message: string; confirm: string } {
  const what = WHAT_IT_ADDED[item.source];
  const deleted =
    item.eventCount > 0
      ? `${events(item.eventCount)} on your timeline (${what})`
      : `what it added to your timeline (${what})`;
  const records = item.source === 'health' ? ' and the daily health records behind them' : '';

  return {
    title: `Delete ${item.title} data?`,
    message: `This deletes ${deleted}${records}, and turns ${item.title} off.\n\n${afterwards(item.source, healthAppName)}`,
    confirm: 'Delete',
  };
}

export function forgottenNotice(
  title: string,
  deletedEvents: number,
): { title: string; message: string } {
  const off = `${title} is off until you turn it on again.`;

  return {
    title: `${title} data deleted`,
    message: deletedEvents > 0 ? `${events(deletedEvents)} deleted. ${off}` : off,
  };
}
