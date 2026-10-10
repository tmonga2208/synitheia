import { describe, expect, it } from 'vitest';
import { detectWorkoutHabit } from './workoutHabit.js';
import { baseCtx, fakeEvent, istAt } from './testing.js';
import type { HabitToday } from './types.js';

const RUN_ID = '6a7025c8d36b5e0013390aaa';
const GYM_ID = '6a7025c8d36b5e0013390bbb';

const habit = (overrides: Partial<HabitToday> = {}): HabitToday => ({
  id: RUN_ID,
  name: 'Morning run',
  measure: 'check',
  frequency: 'daily',
  targetCount: 1,
  reminderTime: null,
  countToday: 0,
  ...overrides,
});

const workout = (activity: string, durationMin = 32) =>
  fakeEvent({
    type: 'workout.detected',
    source: 'health',
    at: istAt('12:00'),
    metadata: { activity, durationMin, calories: 310 },
  });

describe('workout → habit', () => {
  it('asks to mark a matching habit done', () => {
    const event = workout('running');
    const [d] = detectWorkoutHabit(baseCtx({ events: [event], habits: [habit()] }));

    expect(d).toBeDefined();
    expect(d!.detector).toBe(`workout_habit:${RUN_ID}`);
    expect(d!.type).toBe('possible_habit_completion');
    expect(d!.title).toBe('Mark Morning run done?');
    expect(d!.proposed).toEqual({ kind: 'habit', habitId: RUN_ID, count: 1 });
    expect(d!.evidence[0]!.label).toBe('Running, 32 min, from your health data');
    expect(d!.supportingEventIds).toEqual([event._id]);
    expect(d!.confidence).toBeCloseTo(0.8);
  });

  it('is less sure of a generic match', () => {
    const [d] = detectWorkoutHabit(
      baseCtx({ events: [workout('yoga')], habits: [habit({ id: GYM_ID, name: 'Workout' })] }),
    );
    expect(d!.confidence).toBeCloseTo(0.65);
  });

  it('proposes the minutes for a duration habit', () => {
    const [d] = detectWorkoutHabit(
      baseCtx({
        events: [workout('running', 32.4)],
        habits: [habit({ measure: 'duration', targetCount: 30 })],
      }),
    );
    expect(d!.proposed).toEqual({ kind: 'habit', habitId: RUN_ID, count: 32 });
  });

  it('proposes at least one minute for a very short workout', () => {
    const [d] = detectWorkoutHabit(
      baseCtx({
        events: [workout('running', 0.2)],
        habits: [habit({ measure: 'duration', targetCount: 30 })],
      }),
    );
    expect((d!.proposed as { count: number }).count).toBe(1);
  });

  it('says nothing when there is no workout', () => {
    expect(detectWorkoutHabit(baseCtx({ habits: [habit()] }))).toEqual([]);
  });

  it('says nothing for a habit already done today', () => {
    expect(
      detectWorkoutHabit(
        baseCtx({ events: [workout('running')], habits: [habit({ countToday: 1 })] }),
      ),
    ).toEqual([]);
  });

  it('never asks again about a habit the user has rejected', () => {
    expect(
      detectWorkoutHabit(
        baseCtx({
          events: [workout('running')],
          habits: [habit()],
          rejectedHabitIds: new Set([RUN_ID]),
        }),
      ),
    ).toEqual([]);
  });

  it('skips step habits and weekly habits', () => {
    expect(
      detectWorkoutHabit(
        baseCtx({
          events: [workout('walking')],
          habits: [
            habit({ name: 'Walk', measure: 'steps', targetCount: 8000 }),
            habit({ id: GYM_ID, name: 'Walk', frequency: 'weekly' }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('asks once per habit, preferring the specific match', () => {
    const run = workout('running', 20);
    const yoga = workout('yoga', 45);
    const detections = detectWorkoutHabit(
      baseCtx({
        events: [yoga, run],
        habits: [habit(), habit({ id: GYM_ID, name: 'Workout' })],
      }),
    );

    expect(detections.map((d) => d.detector).sort()).toEqual(
      [`workout_habit:${RUN_ID}`, `workout_habit:${GYM_ID}`].sort(),
    );
    const runDetection = detections.find((d) => d.detector.endsWith(RUN_ID))!;
    expect(runDetection.supportingEventIds).toEqual([run._id]);
  });

  it('labels an old numeric activity by its name', () => {
    const [d] = detectWorkoutHabit(baseCtx({ events: [workout('37')], habits: [habit()] }));
    expect(d!.evidence[0]!.label).toBe('Running, 32 min, from your health data');
  });
});
