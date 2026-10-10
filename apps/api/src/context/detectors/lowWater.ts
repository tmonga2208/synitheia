import { addLocalDays, localMinutesOfDay } from '@synitheia/shared';
import type { Detector } from './types.js';

const LOOKBACK_DAYS = 21;

/**
 * Water is trending well below this user's own normal.
 *
 * Compared against the user's own baseline, never a population norm — "8 glasses a day"
 * is a marketing slogan, and telling someone they are failing against a number that was
 * never theirs is exactly the generic nagging the brief rules out.
 */
export const detectLowWater: Detector = (ctx) => {
  const totalOf = (e: { metadata: unknown }): number =>
    (e.metadata as { totalMlToday?: number }).totalMlToday ?? 0;

  const todayMl = ctx.events
    .filter((e) => e.type === 'water.logged')
    .reduce((acc, e) => Math.max(acc, totalOf(e)), 0);

  const since = addLocalDays(ctx.localDate, -LOOKBACK_DAYS);
  const waterByDay = new Map<string, number>();
  for (const e of ctx.history) {
    if (e.type !== 'water.logged' || e.localDate < since) continue;
    waterByDay.set(e.localDate, Math.max(waterByDay.get(e.localDate) ?? 0, totalOf(e)));
  }

  const baselineMl =
    waterByDay.size > 0
      ? [...waterByDay.values()].reduce((a, b) => a + b, 0) / waterByDay.size
      : 0;

  // Needs a real baseline. With three days of history, "below your usual" is noise.
  if (baselineMl < 500) return [];

  // Do not fire before the evening — at 10am, everyone is "behind" on water.
  if (localMinutesOfDay(ctx.now, ctx.timezone) < 19 * 60) return [];

  if (todayMl >= baselineMl * 0.6) return [];

  return [
    {
      detector: 'low_water_vs_baseline',
      type: 'low_water',
      confidence: 0.8,
      title: `You've had ${todayMl} ml today`,
      description: `That's well below your usual ${Math.round(baselineMl)} ml by this time. Your target is ${ctx.waterTargetMl} ml.`,
      evidence: [
        {
          eventId: null,
          label: `Your recent daily average is ${Math.round(baselineMl)} ml`,
          weight: 1,
        },
      ],
      supportingEventIds: [],
      proposed: { kind: 'observation' },
    },
  ];
};
