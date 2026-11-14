import { describe, expect, it } from 'vitest';
import { addLocalDays } from '@synitheia/shared';
import { detectLowWater } from './lowWater.js';
import { TEST_DAY, baseCtx, fakeEvent, istAt } from './testing.js';

/** The last glass of a day, carrying that day's running total. */
const water = (totalMlToday: number, day?: string) =>
  fakeEvent({
    type: 'water.logged',
    at: istAt('18:00', day),
    metadata: { amountMl: 250, totalMlToday },
  });

/** `n` consecutive days before TEST_DAY, each ending on `totalMl`. */
const pastDays = (n: number, totalMl: number) =>
  Array.from({ length: n }, (_, i) => water(totalMl, addLocalDays(TEST_DAY, -(i + 1))));

describe('low water', () => {
  it('speaks in the evening when today is well under the usual', () => {
    const [d] = detectLowWater(
      baseCtx({ now: istAt('20:00'), events: [water(600)], history: pastDays(7, 1450) }),
    );

    expect(d).toBeDefined();
    expect(d!.type).toBe('low_water');
    expect(d!.proposed).toEqual({ kind: 'observation' });
  });

  it('writes amounts the way the rest of the app does: litres from a litre up', () => {
    const [d] = detectLowWater(
      baseCtx({ now: istAt('20:00'), events: [water(600)], history: pastDays(7, 1450) }),
    );

    expect(d!.title).toBe("You've had 600 ml today");
    expect(d!.description).toBe(
      "That's well below your usual 1.45 L by this time. Your target is 2.5 L.",
    );
    expect(d!.evidence[0]!.label).toBe('Your recent daily average is 1.45 L');
  });

  it('says nothing before the evening', () => {
    expect(
      detectLowWater(
        baseCtx({ now: istAt('10:00'), events: [water(200)], history: pastDays(7, 1450) }),
      ),
    ).toEqual([]);
  });

  it('says nothing without a real baseline', () => {
    expect(
      detectLowWater(
        baseCtx({ now: istAt('20:00'), events: [water(100)], history: pastDays(7, 300) }),
      ),
    ).toEqual([]);
  });
});
