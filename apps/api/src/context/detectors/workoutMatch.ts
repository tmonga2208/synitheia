/**
 * Matching a Health workout to a habit by the habit's name.
 *
 * Habits have no "exercise" category, so the name is all there is. That is a guess, which
 * is why this only ever feeds a question ("Mark Morning run done?") and never a write,
 * and why one rejection silences it for that habit.
 */

/**
 * HKWorkoutActivityType raw values → names.
 *
 * The device reader used to send `String(workoutActivityType)`, which for a numeric enum
 * is "37", not "running". The reader now sends the name, but events already stored carry
 * the number, and they must keep matching.
 */
const HK_CODES: Record<string, string> = {
  '13': 'cycling',
  '14': 'dance',
  '16': 'elliptical',
  '20': 'functionalstrengthtraining',
  '24': 'hiking',
  '35': 'rowing',
  '37': 'running',
  '46': 'swimming',
  '50': 'traditionalstrengthtraining',
  '52': 'walking',
  '57': 'yoga',
  '59': 'coretraining',
  '63': 'highintensityintervaltraining',
  '66': 'pilates',
  '73': 'mixedcardio',
  '77': 'cardiodance',
  '78': 'socialdance',
};

export function activityName(raw: string): string {
  const trimmed = raw.trim();
  return HK_CODES[trimmed] ?? trimmed.toLowerCase();
}

/** Habit-name words that mean "any workout counts". */
const GENERIC_WORDS = new Set([
  'workout',
  'exercise',
  'gym',
  'training',
  'train',
  'fitness',
  'cardio',
]);

/** Habit-name words → the fragment an activity name must contain. */
const SPECIFIC_WORDS: Record<string, string> = {
  run: 'running',
  running: 'running',
  jog: 'running',
  jogging: 'running',
  walk: 'walking',
  walking: 'walking',
  cycle: 'cycling',
  cycling: 'cycling',
  bike: 'cycling',
  biking: 'cycling',
  swim: 'swimming',
  swimming: 'swimming',
  yoga: 'yoga',
  strength: 'strength',
  weights: 'strength',
  lifting: 'strength',
  lift: 'strength',
  hike: 'hiking',
  hiking: 'hiking',
  pilates: 'pilates',
  dance: 'dance',
  dancing: 'dance',
};

export function matchWorkout(
  habitName: string,
  activity: string,
): 'specific' | 'generic' | null {
  const words = habitName.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const name = activityName(activity);

  // Whole words on the habit side: "brunch" must not match "run".
  for (const word of words) {
    const fragment = SPECIFIC_WORDS[word];
    if (fragment && name.includes(fragment)) return 'specific';
  }

  // Only a generic word matches any workout. A habit that names one activity and nothing
  // else ("Morning run") falls through to null for a yoga session.
  if (words.some((word) => GENERIC_WORDS.has(word))) return 'generic';

  return null;
}
