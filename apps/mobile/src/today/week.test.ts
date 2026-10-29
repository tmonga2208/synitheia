import { describe, expect, it } from 'vitest';
import type { TodayResponse } from '@synitheia/shared';
import { summarizeWeek, weekOf } from './week.js';

const totals = (waterMl: number) => ({
  waterMl,
  calories: 0,
  spentMinor: 0,
  habitsDone: 0,
  habitsScheduled: 0,
});

function today(week: TodayResponse['weeklyFlow']): TodayResponse {
  return { weeklyFlow: week } as TodayResponse;
}

describe('weekOf', () => {
  it('uses the live value for today and the stored totals for earlier days', () => {
    const days = weekOf(
      today([
        {
          localDate: '2026-10-29' as never,
          percent: 0,
          isToday: false,
          totals: totals(1500),
        },
        {
          localDate: '2026-10-30' as never,
          percent: 0,
          isToday: true,
          totals: totals(250),
        },
      ]),
      (t) => t.waterMl,
      750,
    );
    expect(days?.map((d) => d.value)).toEqual([1500, 750]);
  });

  it('is null when the server sent no totals, so no strip of zeros is drawn', () => {
    expect(
      weekOf(
        today([{ localDate: '2026-10-30' as never, percent: 10, isToday: true }]),
        (t) => t.waterMl,
      ),
    ).toBeNull();
  });
});

describe('summarizeWeek', () => {
  const day = (value: number, isToday = false) => ({ localDate: 'x', value, isToday });

  it('averages only earlier days that had something logged', () => {
    const summary = summarizeWeek([day(2000), day(0), day(1000), day(100, true)], 2000);
    expect(summary.usual).toBe(1500);
    expect(summary.met).toBe(1);
  });

  it('has no usual value when nothing was logged before today', () => {
    expect(summarizeWeek([day(0), day(500, true)], 2000).usual).toBeNull();
  });
});
