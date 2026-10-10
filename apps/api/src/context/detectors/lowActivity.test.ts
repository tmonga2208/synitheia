import { describe, expect, it } from 'vitest';
import { addLocalDays } from '@synitheia/shared';
import { detectLowActivity } from './lowActivity.js';
import { TEST_DAY, baseCtx, fakeEvent, istAt } from './testing.js';

/** Health stamps the day's step event at midday; `syncedAt` is when it was last written. */
const steps = (count: number, day?: string, syncedAt: Date = istAt('23:59', day)) =>
  fakeEvent({
    type: 'steps.recorded',
    source: 'health',
    at: istAt('12:00', day),
    updatedAt: syncedAt,
    metadata: { steps: count, distanceM: null },
  });

/** `n` consecutive days before TEST_DAY, each with `count` steps. */
const pastDays = (n: number, count: number) =>
  Array.from({ length: n }, (_, i) => steps(count, addLocalDays(TEST_DAY, -(i + 1))));

describe('low activity', () => {
  it('fires in the evening when steps are far below the 14-day average', () => {
    const [d] = detectLowActivity(
      baseCtx({ now: istAt('20:00'), events: [steps(3_000)], history: pastDays(10, 8_000) }),
    );

    expect(d).toBeDefined();
    expect(d!.type).toBe('low_activity');
    expect(d!.title).toBe('A quieter day than usual');
    expect(d!.description).toContain('3,000');
    expect(d!.description).toContain('8,000');
    expect(d!.proposed).toEqual({ kind: 'observation' });
  });

  it('does not fire before 7 PM, when everyone is legitimately behind', () => {
    expect(
      detectLowActivity(
        baseCtx({ now: istAt('18:59'), events: [steps(1_000)], history: pastDays(10, 8_000) }),
      ),
    ).toEqual([]);
  });

  it('fires at exactly 7 PM', () => {
    expect(
      detectLowActivity(
        baseCtx({ now: istAt('19:00'), events: [steps(1_000)], history: pastDays(10, 8_000) }),
      ),
    ).toHaveLength(1);
  });

  it('needs seven days of step data', () => {
    expect(
      detectLowActivity(
        baseCtx({ events: [steps(1_000)], history: pastDays(6, 8_000) }),
      ),
    ).toEqual([]);
  });

  it('does not treat a day with no step data as a low day', () => {
    // Health did not sync, or the phone stayed home. Absence is not zero.
    expect(detectLowActivity(baseCtx({ events: [], history: pastDays(10, 8_000) }))).toEqual([]);
  });

  it('does not fire at 60% of the average', () => {
    expect(
      detectLowActivity(baseCtx({ events: [steps(4_800)], history: pastDays(10, 8_000) })),
    ).toEqual([]);
  });

  it('only looks at the last 14 days', () => {
    // Ten high days, but all older than two weeks: not a baseline.
    const old = Array.from({ length: 10 }, (_, i) =>
      steps(8_000, addLocalDays(TEST_DAY, -(15 + i))),
    );
    expect(detectLowActivity(baseCtx({ events: [steps(1_000)], history: old }))).toEqual([]);
  });

  it('does not judge the day on a step count that has not been refreshed', () => {
    // A phone locked in a pocket since 9 AM: Health could not be read, so the event still
    // holds the morning's number. At 8 PM that is stale data, not a quiet day.
    expect(
      detectLowActivity(
        baseCtx({
          now: istAt('20:00'),
          events: [steps(1_200, undefined, istAt('09:00'))],
          history: pastDays(10, 8_000),
        }),
      ),
    ).toEqual([]);
  });

  it('judges a step count synced within the last hour and a half', () => {
    expect(
      detectLowActivity(
        baseCtx({
          now: istAt('20:00'),
          events: [steps(1_200, undefined, istAt('18:31'))],
          history: pastDays(10, 8_000),
        }),
      ),
    ).toHaveLength(1);
  });

  it('is more confident under 40%', () => {
    const mild = detectLowActivity(
      baseCtx({ events: [steps(4_000)], history: pastDays(10, 8_000) }),
    )[0]!;
    const strong = detectLowActivity(
      baseCtx({ events: [steps(2_000)], history: pastDays(10, 8_000) }),
    )[0]!;
    expect(mild.confidence).toBeCloseTo(0.6);
    expect(strong.confidence).toBeCloseTo(0.7);
  });
});
