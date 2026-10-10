import { describe, expect, it } from 'vitest';
import { activityName, matchWorkout } from './workoutMatch.js';

describe('activityName', () => {
  it('passes a HealthKit name through, lower-cased', () => {
    expect(activityName('running')).toBe('running');
    expect(activityName('traditionalStrengthTraining')).toBe('traditionalstrengthtraining');
  });

  it('translates the numeric codes older events were stored with', () => {
    expect(activityName('37')).toBe('running');
    expect(activityName('52')).toBe('walking');
    expect(activityName('13')).toBe('cycling');
    expect(activityName('50')).toBe('traditionalstrengthtraining');
  });

  it('leaves an unknown code as it is rather than guessing', () => {
    expect(activityName('9999')).toBe('9999');
  });
});

describe('matchWorkout', () => {
  it.each([
    ['Morning run', 'running', 'specific'],
    ['Go Running', 'running', 'specific'],
    ['Evening jog', 'running', 'specific'],
    ['Yoga', 'yoga', 'specific'],
    ['Lift weights', 'traditionalStrengthTraining', 'specific'],
    ['Strength', 'functionalStrengthTraining', 'specific'],
    ['Bike to work', 'cycling', 'specific'],
    ['Swim', 'swimming', 'specific'],
    ['Walk the dog', 'walking', 'specific'],
    ['Morning run', '37', 'specific'],
  ] as const)('%s ← %s is a specific match', (habit, activity, expected) => {
    expect(matchWorkout(habit, activity)).toBe(expected);
  });

  it.each([
    ['Workout', 'running'],
    ['Gym', 'traditionalStrengthTraining'],
    ['Exercise 30 min', 'yoga'],
    ['Cardio', 'cycling'],
    ['Daily training', 'other'],
  ] as const)('%s ← %s is a generic match', (habit, activity) => {
    expect(matchWorkout(habit, activity)).toBe('generic');
  });

  it.each([
    ['Read 20 pages', 'running'],
    ['Drink water', 'yoga'],
    // Whole words only: "brunch" contains "run", "trainspotting" contains "train".
    ['Brunch with mum', 'running'],
    ['Trainspotting notes', 'running'],
    // A specific habit does not match a different activity.
    ['Morning run', 'yoga'],
    ['Yoga', 'swimming'],
  ] as const)('%s ← %s does not match', (habit, activity) => {
    expect(matchWorkout(habit, activity)).toBeNull();
  });
});
