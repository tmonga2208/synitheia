import type { CalorieGoal, GoalPace } from '@synitheia/shared';

/** "72.4 kg". Always one decimal, so a change of 0.1 is visible as one. */
export function formatKg(kg: number): string {
  return `${kg.toFixed(1)} kg`;
}

/** "↓ 0.6 kg a week", or a plain word when there is nothing to compare yet. */
export function changeLine(perWeekKg: number | null): string {
  if (perWeekKg === null) return 'Weigh in again in a few days to see a trend';
  if (perWeekKg === 0) return 'No change this week';
  const arrow = perWeekKg < 0 ? '↓' : '↑';
  return `${arrow} ${Math.abs(perWeekKg).toFixed(1)} kg a week`;
}

const GOAL_WORDS: Record<CalorieGoal, string> = {
  lose: 'losing weight',
  maintain: 'staying where you are',
  gain: 'gaining weight',
};

/** How the trend sits against the goal, in a sentence. */
export function paceLine(goal: CalorieGoal, pace: GoalPace): string {
  switch (pace) {
    case 'on_track':
      return `On track for ${GOAL_WORDS[goal]}`;
    case 'fast':
      return goal === 'lose'
        ? 'Faster than a kilo a week, which is hard to keep up. Eating a little more is fine.'
        : 'Faster than a kilo a week. A smaller surplus gains less as fat.';
    case 'steady':
      return `Holding steady. Give it another week before changing anything.`;
    case 'opposite':
      return `Moving away from ${GOAL_WORDS[goal]} this week`;
    case 'drifting':
      return 'Drifting more than half a kilo a week from where you wanted to stay';
  }
}

/** Said after a check-in moved the target, so the change is never silent. */
export function retargetLine(before: number, after: number): string | null {
  if (before === after) return null;
  return `Calorie target moved to ${after.toLocaleString('en-IN')} kcal (was ${before.toLocaleString('en-IN')}) to match your new weight.`;
}
