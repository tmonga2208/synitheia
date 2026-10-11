/**
 * Health Connect exercise types → the activity names HealthKit uses.
 *
 * Health Connect identifies an exercise by number (`ExerciseSessionRecord.EXERCISE_TYPE_*`).
 * The server never sees which phone a workout came from: its workout → habit matching
 * works on the NAME, and it was written against the names iPhone sends. So Android sends
 * those same names, and nothing on the server has to know Health Connect exists.
 *
 * Deliberately a short list. Health Connect has dozens of gym-machine and team-sport types;
 * only the ones a habit name can plausibly match are worth naming, and everything else is
 * a plain "workout".
 */
const NAMES: Readonly<Record<number, string>> = {
  8: 'cycling', //  BIKING
  9: 'cycling', //  BIKING_STATIONARY
  16: 'dance', //  DANCING
  25: 'elliptical',
  36: 'highIntensityIntervalTraining',
  37: 'hiking',
  48: 'pilates',
  53: 'rowing',
  54: 'rowing', //  ROWING_MACHINE
  56: 'running',
  57: 'running', //  RUNNING_TREADMILL
  70: 'traditionalStrengthTraining', //  STRENGTH_TRAINING
  73: 'swimming', //  SWIMMING_OPEN_WATER
  74: 'swimming', //  SWIMMING_POOL
  79: 'walking',
  81: 'traditionalStrengthTraining', //  WEIGHTLIFTING
  83: 'yoga',
};

export function exerciseName(exerciseType: number | null | undefined): string {
  return (exerciseType != null && NAMES[exerciseType]) || 'workout';
}

/** Every specific name this module can emit. For tests that pin the contract. */
export const EXERCISE_NAMES: readonly string[] = [...new Set(Object.values(NAMES))];
