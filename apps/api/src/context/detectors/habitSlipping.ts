import { addLocalDays, localMinutesOfDay } from '@synitheia/shared';
import { minutesLabel } from './labels.js';
import { HABIT_SLIPPING_PREFIX, type Detection, type Detector } from './types.js';

const LOOKBACK_DAYS = 28;
const MIN_COMPLETIONS = 5;
const GRACE_MINUTES = 90;
const CUTOFF_MINUTES = 22 * 60;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/**
 * A habit that is normally done by now, and is not.
 *
 * An observation, not a reminder: it fires from the user's own behaviour rather than a
 * time they set, and it stays silent whenever a reminder they did set is still to come.
 */
export const detectHabitSlipping: Detector = (ctx) => {
  const nowMinutes = localMinutesOfDay(ctx.now, ctx.timezone);
  // Past ten there is nothing left to do about it but feel bad.
  if (nowMinutes >= CUTOFF_MINUTES) return [];

  const since = addLocalDays(ctx.localDate, -LOOKBACK_DAYS);
  const detections: Detection[] = [];

  for (const habit of ctx.habits) {
    // Weekly habits have no "by this time today"; step habits complete from Health.
    if (habit.frequency !== 'daily' || habit.measure === 'steps') continue;
    if (habit.countToday >= habit.targetCount) continue;
    if (habit.reminderTime && toMinutes(habit.reminderTime) > nowMinutes) continue;

    const minutes = ctx.history
      .filter(
        (e) =>
          e.type === 'habit.completed' &&
          e.localDate >= since &&
          (e.metadata as { habitId?: string }).habitId === habit.id,
      )
      .map((e) => localMinutesOfDay(e.timestamp, ctx.timezone));

    if (minutes.length < MIN_COMPLETIONS) continue;

    const usual = median(minutes);
    if (nowMinutes < usual + GRACE_MINUTES) continue;

    detections.push({
      detector: `${HABIT_SLIPPING_PREFIX}:${habit.id}`,
      type: 'missed_habit',
      confidence: minutes.length >= 10 ? 0.7 : 0.6,
      title: `${habit.name} is usually done by now`,
      description: null,
      evidence: [
        {
          eventId: null,
          label: `Usually completed around ${minutesLabel(usual)}, based on ${minutes.length} of the last ${LOOKBACK_DAYS} days`,
          weight: 1,
        },
      ],
      supportingEventIds: [],
      proposed: { kind: 'observation' },
    });
  }

  return detections;
};
