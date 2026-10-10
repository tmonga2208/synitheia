import { localMinutesOfDay, toLocalDate, type SyncSuggestion } from '@synitheia/shared';

/**
 * Which suggestions may raise a notification right now.
 *
 * Pure on purpose: the rules that decide whether the phone buzzes are exactly the ones
 * that must not be wrong, and none of them need a device to test.
 */

export const MAX_PER_DAY = 2;
const QUIET_FROM = 22 * 60;
const QUIET_UNTIL = 7 * 60;
const REMEMBERED_IDS = 50;

export interface NotifyState {
  /** The local day `count` belongs to. */
  localDate: string;
  count: number;
  notifiedIds: string[];
}

export function parseNotifyState(raw: string | null): NotifyState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (
      typeof v.localDate !== 'string' ||
      typeof v.count !== 'number' ||
      !Array.isArray(v.notifiedIds) ||
      !v.notifiedIds.every((id) => typeof id === 'string')
    ) {
      return null;
    }
    return { localDate: v.localDate, count: v.count, notifiedIds: v.notifiedIds as string[] };
  } catch {
    return null;
  }
}

export function selectNotifiable(
  suggestions: readonly SyncSuggestion[],
  state: NotifyState | null,
  now: Date,
  timeZone: string,
): { toNotify: SyncSuggestion[]; nextState: NotifyState } {
  const today = toLocalDate(now, timeZone);
  const base: NotifyState = {
    localDate: today,
    // A new local day starts a new count; the ids are kept so nothing can repeat.
    count: state !== null && state.localDate === today ? state.count : 0,
    notifiedIds: state?.notifiedIds ?? [],
  };

  const minutes = localMinutesOfDay(now, timeZone);
  const quiet = minutes >= QUIET_FROM || minutes < QUIET_UNTIL;
  if (quiet) return { toNotify: [], nextState: base };

  const seen = new Set(base.notifiedIds);
  const toNotify: SyncSuggestion[] = [];

  for (const suggestion of suggestions) {
    if (base.count + toNotify.length >= MAX_PER_DAY) break;
    // An observation is something to read in Today, not something to be interrupted by.
    if (!suggestion.actionable || seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    toNotify.push(suggestion);
  }

  return {
    toNotify,
    nextState: {
      localDate: today,
      count: base.count + toNotify.length,
      notifiedIds: [...base.notifiedIds, ...toNotify.map((s) => s.id)].slice(-REMEMBERED_IDS),
    },
  };
}
