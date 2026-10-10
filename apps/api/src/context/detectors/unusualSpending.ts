import { asMinor, formatMoney, localWeekdayIndex, type LocalDate } from '@synitheia/shared';
import { WEEKDAY_NAMES } from './labels.js';
import type { Detector, EventLean } from './types.js';

const MIN_SAMPLES = 3;
const RATIO = 1.5;
/** ₹100. Stops ₹60 against a ₹40 average from firing on ratio alone. */
const MIN_EXCESS_MINOR = 10_000;

/**
 * Today's spending is well above this user's own normal for this weekday.
 *
 * Same weekday, not a rolling average: a Saturday is not an anomaly for being a Saturday,
 * and comparing it to Tuesdays would fire every weekend.
 */
export const detectUnusualSpending: Detector = (ctx) => {
  const currency = ctx.currency;
  if (!currency) return [];

  // A foreign charge cannot be added to rupees, and converting it would mean inventing a
  // rate. It is left out of both today and the baseline.
  const isHomeExpense = (e: EventLean): boolean =>
    e.type === 'expense.created' &&
    (e.metadata as { currency?: string }).currency === currency;
  const amountOf = (e: EventLean): number =>
    (e.metadata as { amountMinor?: number }).amountMinor ?? 0;

  const todayEvents = ctx.events.filter(isHomeExpense);
  const today = todayEvents.reduce((sum, e) => sum + amountOf(e), 0);
  if (today === 0) return [];

  const weekday = localWeekdayIndex(ctx.localDate);
  const byDay = new Map<string, number>();
  for (const e of ctx.history) {
    if (!isHomeExpense(e)) continue;
    if (localWeekdayIndex(e.localDate as LocalDate) !== weekday) continue;
    byDay.set(e.localDate, (byDay.get(e.localDate) ?? 0) + amountOf(e));
  }

  const samples = [...byDay.values()].filter((total) => total > 0);
  if (samples.length < MIN_SAMPLES) return [];

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (today < mean * RATIO) return [];
  if (today - mean < MIN_EXCESS_MINOR) return [];

  let confidence = 0.6;
  if (today >= mean * 2) confidence += 0.1;
  if (samples.length >= 6) confidence += 0.1;

  const dayName = WEEKDAY_NAMES[weekday]!;
  const todayLabel = formatMoney(asMinor(today), currency);
  const meanLabel = formatMoney(asMinor(Math.round(mean)), currency);

  return [
    {
      detector: 'unusual_spending_vs_weekday',
      type: 'unusual_spending',
      confidence,
      title: `You've spent more than usual for a ${dayName}`,
      description: `${todayLabel} today, against a usual ${meanLabel}.`,
      evidence: [
        { eventId: null, label: `${todayLabel} spent today`, weight: 0.5 },
        {
          eventId: null,
          label: `Your ${dayName} average is ${meanLabel}, based on ${samples.length} ${dayName}s`,
          weight: 0.5,
        },
      ],
      supportingEventIds: todayEvents.map((e) => e._id),
      proposed: { kind: 'observation' },
    },
  ];
};
