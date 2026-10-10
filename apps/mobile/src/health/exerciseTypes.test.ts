import { describe, expect, it } from 'vitest';
import { EXERCISE_NAMES, exerciseName } from './exerciseTypes.js';

describe('exerciseName', () => {
  it.each([
    [56, 'running'],
    [57, 'running'],
    [79, 'walking'],
    [8, 'cycling'],
    [9, 'cycling'],
    [73, 'swimming'],
    [74, 'swimming'],
    [83, 'yoga'],
    [70, 'traditionalStrengthTraining'],
    [81, 'traditionalStrengthTraining'],
    [37, 'hiking'],
    [48, 'pilates'],
    [16, 'dance'],
    [36, 'highIntensityIntervalTraining'],
    [25, 'elliptical'],
    [53, 'rowing'],
    [54, 'rowing'],
  ])('maps Health Connect type %i to %s', (code, name) => {
    expect(exerciseName(code)).toBe(name);
  });

  it.each([0, 2, 64, 999, -1, null, undefined, Number.NaN])(
    'calls an unmapped type (%s) a plain workout',
    (code) => {
      // Only a habit with a generic name ("Workout", "Gym") matches this on the server.
      expect(exerciseName(code)).toBe('workout');
    },
  );

  it('only ever emits names the server schema accepts', () => {
    // workoutSchema.kind is 1 to 60 characters.
    for (const name of [...EXERCISE_NAMES, 'workout']) {
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(60);
    }
  });
});
