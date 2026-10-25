import { Types } from 'mongoose';
import {
  SUGGEST_THRESHOLD,
  addLocalDays,
  localMinutesOfDay,
  todayLocalDate,
  type Evidence,
  type LocalDate,
} from '@synitheia/shared';
import {
  InferredContextModel,
  PersonalEventModel,
  UserPreferenceModel,
  type PersonalEventDoc,
} from '../db/models.js';

/** InferSchemaType omits _id; detectors cite event ids as evidence, so they need it. */
type EventLean = PersonalEventDoc & { _id: Types.ObjectId };

/**
 * Detectors — the "Detect → Infer" half of the loop.
 *
 * Every rule here is DETERMINISTIC. No LLM is involved, and that is a deliberate
 * safety boundary, not a cost decision: a hallucinated meal written into someone's
 * calorie log, or a hallucinated ₹400 into their expenses, is a real harm, and a model
 * that is right 95% of the time will do it roughly once a fortnight. Rules are auditable,
 * explainable, and wrong in ways we can actually fix.
 *
 * A detector NEVER writes a domain record. It writes an InferredContext — a question.
 * Only the user's confirmation (see modules/inference/routes.ts) creates real data.
 */

interface DetectorContext {
  userId: string;
  timezone: string;
  localDate: LocalDate;
  events: EventLean[];
  history: EventLean[];
}

interface Detection {
  detector: string;
  type: 'possible_meal' | 'unusual_spending' | 'low_water';
  confidence: number;
  title: string;
  description: string | null;
  evidence: Evidence[];
  supportingEventIds: Types.ObjectId[];
  proposed:
    | { kind: 'food'; name: string; mealType: 'lunch' | 'dinner' | 'breakfast' | 'snack'; estimatedCalories: number | null }
    | { kind: 'observation' };
}

const MEAL_WINDOWS = [
  { meal: 'breakfast' as const, from: 6 * 60, to: 10 * 60 + 30, label: 'breakfast' },
  { meal: 'lunch' as const, from: 11 * 60 + 30, to: 15 * 60, label: 'lunch' },
  { meal: 'dinner' as const, from: 18 * 60, to: 22 * 60 + 30, label: 'dinner' },
];

function timeLabel(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(instant);
}

/**
 * A food-category expense inside a meal window, on a day with no food logged yet,
 * probably means the user ate and did not log it.
 *
 * Confidence starts moderate and is raised by corroborating signals — the same shape of
 * expense at the same time on previous days, a location arrival nearby. It is never
 * raised to 1.0: this is a guess, and the UI must be able to say so.
 */
function detectPossibleMeal(ctx: DetectorContext): Detection | null {
  const alreadyLogged = ctx.events.some((e) => e.type === 'food.logged');
  if (alreadyLogged) return null;

  const foodExpenses = ctx.events.filter(
    (e) =>
      e.type === 'expense.created' &&
      (e.metadata as { categoryName?: string }).categoryName === 'Food',
  );

  if (foodExpenses.length === 0) return null;

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
    const similarPast = ctx.history.filter((e) => {
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

    return {
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
    };
  }

  return null;
}

/**
 * Water is trending well below this user's own normal.
 *
 * Compared against the user's own baseline, never a population norm — "8 glasses a day"
 * is a marketing slogan, and telling someone they are failing against a number that was
 * never theirs is exactly the generic nagging the brief rules out.
 */
function detectLowWater(
  ctx: DetectorContext,
  todayMl: number,
  baselineMl: number,
  targetMl: number,
): Detection | null {
  // Needs a real baseline. With three days of history, "below your usual" is noise.
  if (baselineMl < 500) return null;

  const nowMinutes = localMinutesOfDay(new Date(), ctx.timezone);
  // Do not fire before the evening — at 10am, everyone is "behind" on water.
  if (nowMinutes < 19 * 60) return null;

  if (todayMl >= baselineMl * 0.6) return null;

  return {
    detector: 'low_water_vs_baseline',
    type: 'low_water',
    confidence: 0.8,
    title: `You've had ${todayMl} ml today`,
    description: `That's well below your usual ${Math.round(baselineMl)} ml by this time. Your target is ${targetMl} ml.`,
    evidence: [
      {
        eventId: null,
        label: `Your recent daily average is ${Math.round(baselineMl)} ml`,
        weight: 1,
      },
    ],
    supportingEventIds: [],
    proposed: { kind: 'observation' },
  };
}

/**
 * Run every detector for a user's day and persist any new suggestions.
 *
 * The (userId, detector, localDate) unique index means a detector asks a given question
 * at most once per day. Without it, every app open would re-ask "did you have lunch?"
 * and the Today screen would become the cluttered nag-list the brief forbids.
 */
export async function runDetectors(
  userId: string,
  timezone: string,
  localDate: LocalDate = todayLocalDate(timezone),
): Promise<number> {
  const uid = new Types.ObjectId(userId);

  const [events, history, prefs] = await Promise.all([
    PersonalEventModel.find({ userId: uid, localDate }).lean<EventLean[]>(),
    PersonalEventModel.find({
      userId: uid,
      localDate: { $gte: addLocalDays(localDate, -21), $lt: localDate },
    }).lean<EventLean[]>(),
    UserPreferenceModel.findOne({ userId: uid }).lean(),
  ]);

  const ctx: DetectorContext = { userId, timezone, localDate, events, history };

  const waterToday = events
    .filter((e) => e.type === 'water.logged')
    .reduce((acc, e) => Math.max(acc, (e.metadata as { totalMlToday?: number }).totalMlToday ?? 0), 0);

  const waterByDay = new Map<string, number>();
  for (const e of history) {
    if (e.type !== 'water.logged') continue;
    const total = (e.metadata as { totalMlToday?: number }).totalMlToday ?? 0;
    waterByDay.set(e.localDate, Math.max(waterByDay.get(e.localDate) ?? 0, total));
  }

  const baseline =
    waterByDay.size > 0
      ? [...waterByDay.values()].reduce((a, b) => a + b, 0) / waterByDay.size
      : 0;

  const detections = [
    detectPossibleMeal(ctx),
    detectLowWater(ctx, waterToday, baseline, prefs?.waterTargetMl ?? 2500),
  ].filter((d): d is Detection => d !== null);

  let created = 0;

  for (const d of detections) {
    const result = await InferredContextModel.updateOne(
      { userId: uid, detector: d.detector, localDate },
      {
        $setOnInsert: {
          userId: uid,
          detector: d.detector,
          localDate,
          type: d.type,
          confidence: d.confidence,
          title: d.title,
          description: d.description,
          evidence: d.evidence,
          supportingEventIds: d.supportingEventIds,
          proposed: d.proposed,
          status: 'pending',
          // Stale suggestions are noise. A "did you have lunch?" card from four days
          // ago is not a question anyone wants to answer.
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          resolvedAt: null,
          correction: null,
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) created += 1;
  }

  return created;
}
