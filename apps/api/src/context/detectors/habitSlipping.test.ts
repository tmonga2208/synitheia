import { describe, expect, it } from 'vitest';
import { addLocalDays } from '@synitheia/shared';
import { detectHabitSlipping } from './habitSlipping.js';
import { TEST_DAY, baseCtx, fakeEvent, istAt } from './testing.js';
import type { HabitToday } from './types.js';

const HABIT_ID = '6a7025c8d36b5e0013390aaa';

const habit = (overrides: Partial<HabitToday> = {}): HabitToday => ({
  id: HABIT_ID,
  name: 'Reading',
  measure: 'check',
  frequency: 'daily',
  targetCount: 1,
  reminderTime: null,
  countToday: 0,
  ...overrides,
});

/** `n` past completions at `time`, one per day going back from yesterday. */
const completions = (n: number, time: string, habitId = HABIT_ID) =>
  Array.from({ length: n }, (_, i) =>
    fakeEvent({
      type: 'habit.completed',
      at: istAt(time, addLocalDays(TEST_DAY, -(i + 1))),
      metadata: { habitId, habitName: 'Reading' },
    }),
  );

describe('habit slipping', () => {
  it('fires 90 minutes past the usual completion time', () => {
    const [d] = detectHabitSlipping(
      baseCtx({ now: istAt('10:10'), habits: [habit()], history: completions(6, '08:40') }),
    );

    expect(d).toBeDefined();
    expect(d!.detector).toBe(`habit_slipping:${HABIT_ID}`);
    expect(d!.type).toBe('missed_habit');
    expect(d!.title).toBe('Reading is usually done by now');
    expect(d!.evidence[0]!.label).toBe(
      'Usually completed around 8:40 AM, based on 6 of the last 28 days',
    );
    expect(d!.proposed).toEqual({ kind: 'observation' });
  });

  it('does not fire at 89 minutes past', () => {
    expect(
      detectHabitSlipping(
        baseCtx({ now: istAt('10:09'), habits: [habit()], history: completions(6, '08:40') }),
      ),
    ).toEqual([]);
  });

  it('needs five past completions', () => {
    expect(
      detectHabitSlipping(
        baseCtx({ now: istAt('12:00'), habits: [habit()], history: completions(4, '08:40') }),
      ),
    ).toEqual([]);
  });

  it('is silent once the habit is done today', () => {
    expect(
      detectHabitSlipping(
        baseCtx({
          now: istAt('12:00'),
          habits: [habit({ countToday: 1 })],
          history: completions(6, '08:40'),
        }),
      ),
    ).toEqual([]);
  });

  it('is silent from 10 PM — too late to act on', () => {
    expect(
      detectHabitSlipping(
        baseCtx({ now: istAt('22:00'), habits: [habit()], history: completions(6, '08:40') }),
      ),
    ).toEqual([]);
  });

  it('defers to a reminder that is still to come today', () => {
    expect(
      detectHabitSlipping(
        baseCtx({
          now: istAt('12:00'),
          habits: [habit({ reminderTime: '19:00' })],
          history: completions(6, '08:40'),
        }),
      ),
    ).toEqual([]);
  });

  it('fires when the reminder has already passed', () => {
    expect(
      detectHabitSlipping(
        baseCtx({
          now: istAt('12:00'),
          habits: [habit({ reminderTime: '09:00' })],
          history: completions(6, '08:40'),
        }),
      ),
    ).toHaveLength(1);
  });

  it('skips weekly habits and step habits', () => {
    const ctx = baseCtx({
      now: istAt('12:00'),
      habits: [habit({ frequency: 'weekly' }), habit({ measure: 'steps', targetCount: 8000 })],
      history: completions(6, '08:40'),
    });
    expect(detectHabitSlipping(ctx)).toEqual([]);
  });

  it('uses the median, so one late night does not move the usual time', () => {
    const history = [
      ...completions(5, '08:40'),
      fakeEvent({
        type: 'habit.completed',
        at: istAt('21:30', addLocalDays(TEST_DAY, -6)),
        metadata: { habitId: HABIT_ID, habitName: 'Reading' },
      }),
    ];
    expect(
      detectHabitSlipping(baseCtx({ now: istAt('10:10'), habits: [habit()], history })),
    ).toHaveLength(1);
  });

  it('ignores completions older than 28 days and other habits', () => {
    const old = Array.from({ length: 6 }, (_, i) =>
      fakeEvent({
        type: 'habit.completed',
        at: istAt('08:40', addLocalDays(TEST_DAY, -(29 + i))),
        metadata: { habitId: HABIT_ID, habitName: 'Reading' },
      }),
    );
    const other = completions(6, '08:40', '6a7025c8d36b5e0013390bbb');
    expect(
      detectHabitSlipping(
        baseCtx({ now: istAt('12:00'), habits: [habit()], history: [...old, ...other] }),
      ),
    ).toEqual([]);
  });

  it('is more confident with ten or more completions', () => {
    const few = detectHabitSlipping(
      baseCtx({ now: istAt('12:00'), habits: [habit()], history: completions(5, '08:40') }),
    )[0]!;
    const many = detectHabitSlipping(
      baseCtx({ now: istAt('12:00'), habits: [habit()], history: completions(10, '08:40') }),
    )[0]!;
    expect(few.confidence).toBeCloseTo(0.6);
    expect(many.confidence).toBeCloseTo(0.7);
  });
});
