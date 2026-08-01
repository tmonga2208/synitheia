import { describe, expect, it } from 'vitest';
import { asLocalDate, type LocalDate } from '../time/local-date.js';
import { DEFAULT_TRACKED_DOMAINS } from './today.js';
import {
  flowPercentForSummary,
  monthStats,
  monthSummaryResponseSchema,
  type FlowSummaryInput,
} from './month-summary.js';

function summary(overrides: Partial<FlowSummaryInput> = {}): FlowSummaryInput {
  return {
    habits: { scheduled: 2, completionRate: 1 },
    water: { totalMl: 2500, targetMl: 2500, entryCount: 3 },
    nutrition: { totals: { calories: 2000 }, calorieTarget: 2000, entryCount: 2 },
    ...overrides,
  };
}

describe('flowPercentForSummary', () => {
  it('is 100 when every tracked component is met', () => {
    expect(flowPercentForSummary(summary(), DEFAULT_TRACKED_DOMAINS)).toBe(100);
  });

  it('averages the active components evenly', () => {
    const half = summary({ water: { totalMl: 1250, targetMl: 2500, entryCount: 2 } });
    // habits 100, water 50, nutrition 100 -> 83.33 -> 83
    expect(flowPercentForSummary(half, DEFAULT_TRACKED_DOMAINS)).toBe(83);
  });

  it('excludes a domain the user does not track', () => {
    const noWater = summary({ water: { totalMl: 0, targetMl: 2500, entryCount: 4 } });
    // Water would drag this to 67 if counted; tracking only habits keeps it at 100.
    expect(flowPercentForSummary(noWater, ['habits'])).toBe(100);
  });

  it('excludes a tracker with no entries that day rather than scoring it zero', () => {
    // Matching the weekly chart: an untouched tracker is absent, not a failure.
    const untouched = summary({
      water: { totalMl: 0, targetMl: 2500, entryCount: 0 },
      nutrition: { totals: { calories: 0 }, calorieTarget: 2000, entryCount: 0 },
    });
    expect(flowPercentForSummary(untouched, DEFAULT_TRACKED_DOMAINS)).toBe(100);
  });

  it('scores a tracked habit day with nothing completed as zero, not absent', () => {
    const missed = summary({
      habits: { scheduled: 3, completionRate: 0 },
      water: { totalMl: 0, targetMl: 2500, entryCount: 0 },
      nutrition: { totals: { calories: 0 }, calorieTarget: 2000, entryCount: 0 },
    });
    expect(flowPercentForSummary(missed, DEFAULT_TRACKED_DOMAINS)).toBe(0);
  });

  it('is 0, never NaN, when nothing at all is active', () => {
    const empty = summary({
      habits: { scheduled: 0, completionRate: 0 },
      water: { totalMl: 0, targetMl: 2500, entryCount: 0 },
      nutrition: { totals: { calories: 0 }, calorieTarget: 2000, entryCount: 0 },
    });
    expect(flowPercentForSummary(empty, DEFAULT_TRACKED_DOMAINS)).toBe(0);
  });

  it('clamps an overshot component at 100', () => {
    const overshoot = summary({ water: { totalMl: 9000, targetMl: 2500, entryCount: 5 } });
    expect(flowPercentForSummary(overshoot, DEFAULT_TRACKED_DOMAINS)).toBe(100);
  });
});

function day(localDate: string, percent: number, eventCount = 1) {
  return { localDate: asLocalDate(localDate) as LocalDate, percent, eventCount };
}

describe('monthStats', () => {
  it('is all zeroes for an empty month', () => {
    expect(monthStats([])).toEqual({ avgPercent: 0, daysLogged: 0, bestFlowRun: 0 });
  });

  it('counts only the days present', () => {
    const stats = monthStats([day('2026-07-01', 80), day('2026-07-05', 40)]);
    expect(stats.daysLogged).toBe(2);
  });

  it('averages only the days present, so gaps do not drag the mean down', () => {
    // Two days at 80 and 40 average to 60 — not 60/31 as they would if the 29
    // untouched days counted as zero.
    expect(monthStats([day('2026-07-01', 80), day('2026-07-05', 40)]).avgPercent).toBe(60);
  });

  it('finds the longest consecutive run at or above the threshold', () => {
    const stats = monthStats([
      day('2026-07-01', 90),
      day('2026-07-02', 70),
      day('2026-07-03', 60), // exactly at the threshold — counts
      day('2026-07-04', 20), // breaks the run at 3
      day('2026-07-05', 95),
      day('2026-07-06', 95),
    ]);
    expect(stats.bestFlowRun).toBe(3);
  });

  it('breaks a run on a missing day even when both sides are high', () => {
    const stats = monthStats([
      day('2026-07-01', 90),
      day('2026-07-02', 90),
      // 2026-07-03 absent
      day('2026-07-04', 90),
    ]);
    expect(stats.bestFlowRun).toBe(2);
  });

  it('handles days arriving out of order', () => {
    const stats = monthStats([
      day('2026-07-03', 90),
      day('2026-07-01', 90),
      day('2026-07-02', 90),
    ]);
    expect(stats.bestFlowRun).toBe(3);
  });
});

describe('monthSummaryResponseSchema', () => {
  it('accepts a well-formed payload', () => {
    const parsed = monthSummaryResponseSchema.parse({
      month: '2026-07',
      earliestLocalDate: '2026-03-14',
      days: [{ localDate: '2026-07-18', percent: 82, eventCount: 7 }],
      stats: { avgPercent: 82, daysLogged: 1, bestFlowRun: 1 },
    });
    expect(parsed.days[0]?.percent).toBe(82);
  });

  it('rejects a malformed month', () => {
    expect(() =>
      monthSummaryResponseSchema.parse({
        month: '2026-7',
        earliestLocalDate: '2026-03-14',
        days: [],
        stats: { avgPercent: 0, daysLogged: 0, bestFlowRun: 0 },
      }),
    ).toThrow();
  });

  it('rejects a percent outside 0-100', () => {
    expect(() =>
      monthSummaryResponseSchema.parse({
        month: '2026-07',
        earliestLocalDate: '2026-03-14',
        days: [{ localDate: '2026-07-18', percent: 120, eventCount: 1 }],
        stats: { avgPercent: 0, daysLogged: 0, bestFlowRun: 0 },
      }),
    ).toThrow();
  });
});
