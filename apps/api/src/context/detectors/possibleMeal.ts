import { SUGGEST_THRESHOLD, addLocalDays, localMinutesOfDay, type Evidence } from '@synitheia/shared';
import { timeLabel } from './labels.js';
import type { Detector } from './types.js';

/** This rule was tuned on three weeks of history; the runner now loads eight. */
const LOOKBACK_DAYS = 21;

const MEAL_WINDOWS = [
  { meal: 'breakfast' as const, from: 6 * 60, to: 10 * 60 + 30, label: 'breakfast' },
  { meal: 'lunch' as const, from: 11 * 60 + 30, to: 15 * 60, label: 'lunch' },
  { meal: 'dinner' as const, from: 18 * 60, to: 22 * 60 + 30, label: 'dinner' },
];

/**
 * A food-category expense inside a meal window, on a day with no food logged yet,
 * probably means the user ate and did not log it.
 *
 * Confidence starts moderate and is raised by corroborating signals — the same shape of
 * expense at the same time on previous days, a location arrival nearby. It is never
 * raised to 1.0: this is a guess, and the UI must be able to say so.
 */
export const detectPossibleMeal: Detector = (ctx) => {
  const alreadyLogged = ctx.events.some((e) => e.type === 'food.logged');
  if (alreadyLogged) return [];

  const foodExpenses = ctx.events.filter(
    (e) =>
      e.type === 'expense.created' &&
      (e.metadata as { categoryName?: string }).categoryName === 'Food',
  );

  if (foodExpenses.length === 0) return [];

  for (const expense of foodExpenses) {
    const minutes = localMinutesOfDay(expense.timestamp, ctx.timezone);
    const window = MEAL_WINDOWS.find((w) => minutes >= w.from && minutes <= w.to);
    if (!window) continue;

    const evidence: Evidence[] = [
      {
        eventId: expense._id.toString(),
        label: `Food expense at ${timeLabel(expense.timestamp, ctx.timezone)}`,
        weight: 0.6,
      },
    ];

    let confidence = 0.62;

    // Corroboration: has this user made a similar expense in this window before? A
    // recurring pattern is far stronger evidence than a one-off.
    const since = addLocalDays(ctx.localDate, -LOOKBACK_DAYS);
    const similarPast = ctx.history.filter((e) => {
      if (e.localDate < since) return false;
      if (e.type !== 'expense.created') return false;
      if ((e.metadata as { categoryName?: string }).categoryName !== 'Food') return false;
      const m = localMinutesOfDay(e.timestamp, ctx.timezone);
      return m >= window.from && m <= window.to;
    });

    if (similarPast.length >= 3) {
      confidence += 0.18;
      evidence.push({
        eventId: null,
        label: `You've made a similar ${window.label} purchase ${similarPast.length} times recently`,
        weight: 0.3,
      });
    }

    const nearbyArrival = ctx.events.find(
      (e) =>
        e.type === 'location.arrived' &&
        Math.abs(e.timestamp.getTime() - expense.timestamp.getTime()) < 45 * 60_000,
    );

    if (nearbyArrival) {
      confidence += 0.1;
      const place = (nearbyArrival.metadata as { placeLabel?: string }).placeLabel;
      evidence.push({
        eventId: nearbyArrival._id.toString(),
        label: place ? `You arrived at ${place} around then` : 'You arrived somewhere around then',
        weight: 0.2,
      });
    }

    // Cap below certainty. We are guessing, and the UI has to be able to say so honestly.
    confidence = Math.min(0.92, confidence);
    if (confidence < SUGGEST_THRESHOLD) continue;

    return [
      {
        detector: 'possible_meal_from_food_expense',
        type: 'possible_meal',
        confidence,
        title: `Looks like you had ${window.label} around ${timeLabel(expense.timestamp, ctx.timezone)}`,
        description: 'Add it to today?',
        evidence,
        supportingEventIds: [expense._id, ...(nearbyArrival ? [nearbyArrival._id] : [])],
        proposed: {
          kind: 'food',
          name: `${window.label.charAt(0).toUpperCase()}${window.label.slice(1)}`,
          mealType: window.meal,
          // We genuinely do not know the calories. Guessing a number and writing it into
          // someone's nutrition log would be worse than leaving it for them to fill in.
          estimatedCalories: null,
        },
      },
    ];
  }

  return [];
};
