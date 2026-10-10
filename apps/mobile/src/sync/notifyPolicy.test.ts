import { describe, expect, it } from 'vitest';
import type { SyncSuggestion } from '@synitheia/shared';
import { parseNotifyState, selectNotifiable } from './notifyPolicy.js';

const IST = 'Asia/Kolkata';
/** `HH:mm` IST on 2026-07-12. */
const at = (time: string, day = '2026-07-12'): Date => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return new Date(Date.parse(`${day}T00:00:00Z`) + (h * 60 + m - 330) * 60_000);
};

const s = (id: string, actionable = true): SyncSuggestion => ({
  id,
  type: actionable ? 'possible_habit_completion' : 'unusual_spending',
  title: `Suggestion ${id}`,
  actionable,
});

describe('selectNotifiable', () => {
  it('notifies an actionable suggestion in the daytime', () => {
    const { toNotify, nextState } = selectNotifiable([s('a')], null, at('14:00'), IST);
    expect(toNotify.map((x) => x.id)).toEqual(['a']);
    expect(nextState).toEqual({ localDate: '2026-07-12', count: 1, notifiedIds: ['a'] });
  });

  it('never notifies an observation', () => {
    const { toNotify } = selectNotifiable([s('a', false)], null, at('14:00'), IST);
    expect(toNotify).toEqual([]);
  });

  it('never notifies the same suggestion twice', () => {
    const state = { localDate: '2026-07-12', count: 1, notifiedIds: ['a'] };
    const { toNotify, nextState } = selectNotifiable([s('a')], state, at('15:00'), IST);
    expect(toNotify).toEqual([]);
    expect(nextState).toEqual(state);
  });

  it('stops at two a day', () => {
    const { toNotify, nextState } = selectNotifiable(
      [s('a'), s('b'), s('c')],
      null,
      at('14:00'),
      IST,
    );
    expect(toNotify.map((x) => x.id)).toEqual(['a', 'b']);
    expect(nextState.count).toBe(2);

    const later = selectNotifiable([s('d')], nextState, at('16:00'), IST);
    expect(later.toNotify).toEqual([]);
  });

  it('starts a fresh count on a new local day', () => {
    const state = { localDate: '2026-07-11', count: 2, notifiedIds: ['x', 'y'] };
    const { toNotify, nextState } = selectNotifiable([s('a')], state, at('09:00'), IST);
    expect(toNotify.map((x) => x.id)).toEqual(['a']);
    expect(nextState.localDate).toBe('2026-07-12');
    expect(nextState.count).toBe(1);
    // Yesterday's ids are kept so a re-delivered suggestion still cannot repeat.
    expect(nextState.notifiedIds).toEqual(['x', 'y', 'a']);
  });

  it.each(['22:00', '23:30', '00:15', '06:59'])('stays quiet at %s', (time) => {
    expect(selectNotifiable([s('a')], null, at(time), IST).toNotify).toEqual([]);
  });

  it.each(['07:00', '21:59'])('may notify at %s', (time) => {
    expect(selectNotifiable([s('a')], null, at(time), IST).toNotify).toHaveLength(1);
  });

  it("uses the user's zone, not UTC, for the day and the quiet hours", () => {
    // 01:00 UTC on the 12th is 06:30 IST: still quiet, and already the 12th locally.
    const now = new Date('2026-07-12T01:00:00Z');
    const { toNotify, nextState } = selectNotifiable([s('a')], null, now, IST);
    expect(toNotify).toEqual([]);
    expect(nextState.localDate).toBe('2026-07-12');
  });

  it('keeps the remembered ids bounded', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `old-${i}`);
    const state = { localDate: '2026-07-11', count: 0, notifiedIds: ids };
    const { nextState } = selectNotifiable([s('new')], state, at('09:00'), IST);
    expect(nextState.notifiedIds).toHaveLength(50);
    expect(nextState.notifiedIds.at(-1)).toBe('new');
  });
});

describe('parseNotifyState', () => {
  it('reads back what was stored', () => {
    const state = { localDate: '2026-07-12', count: 1, notifiedIds: ['a'] };
    expect(parseNotifyState(JSON.stringify(state))).toEqual(state);
  });

  it.each([null, '', 'not json', '{"count":"two"}', '[]', '{"localDate":5}'])(
    'treats %j as no state rather than throwing',
    (raw) => {
      expect(parseNotifyState(raw)).toBeNull();
    },
  );
});
