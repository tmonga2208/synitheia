import { describe, expect, it } from 'vitest';
import type { LocalDate } from '@synitheia/shared';
import { lastSeven } from './lastSeven.js';

const today = '2026-10-30' as LocalDate;

describe('lastSeven', () => {
  it('reads earlier days from the history, oldest first', () => {
    const days = lastSeven(
      [
        { localDate: '2026-10-24', count: 1, targetCount: 1, complete: true },
        { localDate: '2026-10-27', count: 5, targetCount: 20, complete: false },
      ],
      today,
      { todayComplete: false, todayCount: 0 },
    );

    expect(days.map((d) => d.localDate)).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
    expect(days.map((d) => d.state)).toEqual([
      'done',
      'none',
      'none',
      'some',
      'none',
      'none',
      'none',
    ]);
  });

  it('takes today from the live habit, not a history loaded before the tick', () => {
    const days = lastSeven(
      [{ localDate: '2026-10-30', count: 0, targetCount: 1, complete: false }],
      today,
      { todayComplete: true, todayCount: 1 },
    );
    expect(days[6]?.state).toBe('done');
  });
});
