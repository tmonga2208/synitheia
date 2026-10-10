import { addLocalDays, localMinutesOfDay } from '@synitheia/shared';
import type { Detector, EventLean } from './types.js';

const LOOKBACK_DAYS = 14;
const MIN_DAYS = 7;
const EVENING_MINUTES = 19 * 60;
const RATIO = 0.6;
/** How recently today's step count must have been written to be judged at all. */
const FRESH_MS = 90 * 60_000;

const stepsOf = (e: EventLean): number => (e.metadata as { steps?: number }).steps ?? 0;

/**
 * Steps are well under this user's own recent normal, late enough in the day to mean it.
 *
 * Against their own average, never 10,000: a number from a 1960s pedometer advert is not
 * a baseline for anyone.
 */
export const detectLowActivity: Detector = (ctx) => {
  // No step event today means Health has not reported, not that the user sat still.
  const todayEvent = ctx.events.find((e) => e.type === 'steps.recorded');
  if (!todayEvent) return [];

  if (localMinutesOfDay(ctx.now, ctx.timezone) < EVENING_MINUTES) return [];

  // A background Health read returns nothing while the phone is locked, so after a day in
  // a pocket this event can still hold the morning's number. A calendar sync or a Today
  // load would then call a normal day "quiet" — and the once-per-day rule would keep that
  // card up after the real count arrived. Stale data is no data.
  const syncedAt = (todayEvent as { updatedAt?: Date }).updatedAt;
  if (!syncedAt || ctx.now.getTime() - syncedAt.getTime() > FRESH_MS) return [];

  const since = addLocalDays(ctx.localDate, -LOOKBACK_DAYS);
  const recent = ctx.history.filter(
    (e) => e.type === 'steps.recorded' && e.localDate >= since,
  );
  if (recent.length < MIN_DAYS) return [];

  const mean = recent.reduce((sum, e) => sum + stepsOf(e), 0) / recent.length;
  const today = stepsOf(todayEvent);
  if (mean <= 0 || today >= mean * RATIO) return [];

  const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

  return [
    {
      detector: 'low_activity_vs_baseline',
      type: 'low_activity',
      confidence: today < mean * 0.4 ? 0.7 : 0.6,
      title: 'A quieter day than usual',
      description: `${fmt(today)} steps so far, against a usual ${fmt(mean)}.`,
      evidence: [
        { eventId: todayEvent._id.toString(), label: `${fmt(today)} steps today`, weight: 0.5 },
        {
          eventId: null,
          label: `Your average is ${fmt(mean)} steps, over ${recent.length} recent days`,
          weight: 0.5,
        },
      ],
      supportingEventIds: [todayEvent._id],
      proposed: { kind: 'observation' },
    },
  ];
};
