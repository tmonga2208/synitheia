import { activityName, matchWorkout } from './workoutMatch.js';
import type { Detection, Detector, EventLean } from './types.js';

const CONFIDENCE = { specific: 0.8, generic: 0.65 } as const;

/** "traditionalstrengthtraining" is not something to show a person. */
function displayActivity(raw: string): string {
  const name = activityName(raw);
  if (name.includes('strength')) return 'Strength training';
  if (/^\d+$/.test(name)) return 'Workout';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Health recorded a workout, and a habit that looks like it is not done yet.
 *
 * This asks; it does not log. Step habits are the one place Health writes directly, and
 * that is because a step count IS the measurement the habit asks for. "A run happened"
 * is only evidence that "Morning run" was done — the user decides.
 */
export const detectWorkoutHabit: Detector = (ctx) => {
  const workouts = ctx.events.filter((e) => e.type === 'workout.detected');
  if (workouts.length === 0) return [];

  const detections: Detection[] = [];

  for (const habit of ctx.habits) {
    if (habit.frequency !== 'daily' || habit.measure === 'steps') continue;
    if (habit.countToday >= habit.targetCount) continue;
    if (ctx.rejectedHabitIds.has(habit.id)) continue;

    let best: { event: EventLean; kind: 'specific' | 'generic' } | null = null;
    for (const event of workouts) {
      const activity = (event.metadata as { activity?: string }).activity ?? '';
      const kind = matchWorkout(habit.name, activity);
      if (!kind) continue;
      if (!best || (kind === 'specific' && best.kind === 'generic')) best = { event, kind };
    }
    if (!best) continue;

    const meta = best.event.metadata as { activity?: string; durationMin?: number };
    const minutes = Math.round(meta.durationMin ?? 0);

    detections.push({
      detector: `workout_habit:${habit.id}`,
      type: 'possible_habit_completion',
      confidence: CONFIDENCE[best.kind],
      title: `Mark ${habit.name} done?`,
      description: null,
      evidence: [
        {
          eventId: best.event._id.toString(),
          label: `${displayActivity(meta.activity ?? '')}, ${minutes} min, from Apple Health`,
          weight: 1,
        },
      ],
      supportingEventIds: [best.event._id],
      proposed: {
        kind: 'habit',
        habitId: habit.id,
        // A duration habit is credited the minutes; anything else, one completion.
        count: habit.measure === 'duration' ? Math.max(1, minutes) : 1,
      },
    });
  }

  return detections;
};
