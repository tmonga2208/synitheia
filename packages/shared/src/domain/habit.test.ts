import { describe, expect, it } from 'vitest';
import {
  HABIT_MEASURES,
  createHabitSchema,
  formatHabitProgress,
  formatHabitTarget,
  isHabitComplete,
  measureOf,
  updateHabitSchema,
} from './habit.js';

const base = {
  name: 'Walk',
  icon: 'Footprints',
  color: '#7D927D',
  frequency: 'daily',
} as const;

describe('measureOf', () => {
  /**
   * The whole reason this helper exists. Habits written before `measure` existed come back
   * from a `.lean()` read with the field simply absent — Mongo does not apply a schema
   * default on read. Reading `habit.measure` directly would yield `undefined`, and every
   * lookup into HABIT_MEASURES would explode.
   */
  it('treats a habit with no measure as a plain check', () => {
    expect(measureOf({})).toBe('check');
    expect(measureOf({ measure: null })).toBe('check');
  });

  it('respects an explicit measure', () => {
    expect(measureOf({ measure: 'steps' })).toBe('steps');
  });
});

describe('createHabitSchema', () => {
  it('defaults to a check with a target of 1', () => {
    const habit = createHabitSchema.parse(base);
    expect(habit.measure).toBe('check');
    expect(habit.targetCount).toBe(1);
  });

  it('accepts a step goal well past the old ceiling of 100', () => {
    const habit = createHabitSchema.parse({
      ...base,
      measure: 'steps',
      targetCount: 8000,
      unit: 'steps',
    });

    expect(habit.targetCount).toBe(8000);
  });

  // The bug that made every habit a checkbox: targetCount was capped at 100, so a step
  // goal was not merely unsupported, it was unrepresentable.
  it('rejects a step goal below the measure minimum', () => {
    const result = createHabitSchema.safeParse({ ...base, measure: 'steps', targetCount: 3 });
    expect(result.success).toBe(false);
  });

  it('rejects a check with a target other than 1', () => {
    const result = createHabitSchema.safeParse({ ...base, measure: 'check', targetCount: 7 });
    expect(result.success).toBe(false);
  });

  it('rejects a duration longer than a day', () => {
    const result = createHabitSchema.safeParse({
      ...base,
      measure: 'duration',
      targetCount: 2000,
    });
    expect(result.success).toBe(false);
  });

  it('allows a partial update, since a patch cannot carry the whole cross-field rule', () => {
    // updateHabitSchema unwraps the superRefine — a request that sets only targetCount has
    // no `measure` to validate it against.
    expect(updateHabitSchema.parse({ targetCount: 12 })).toEqual({ targetCount: 12 });
  });
});

describe('formatting', () => {
  const steps = { measure: 'steps', targetCount: 8000, unit: 'steps' } as const;

  it('groups thousands so a step goal is readable', () => {
    expect(formatHabitTarget(steps)).toBe('8,000 steps');
    expect(formatHabitProgress(steps, 3500)).toBe('3,500 / 8,000 steps');
  });

  it('has nothing to say about a plain check', () => {
    const check = { measure: 'check', targetCount: 1, unit: null } as const;
    expect(formatHabitTarget(check)).toBe('');
    expect(formatHabitProgress(check, 0)).toBe('');
  });

  it('falls back to the measure default when no unit is stored', () => {
    expect(formatHabitTarget({ measure: 'duration', targetCount: 20 })).toBe('20 min');
  });

  it('uses a custom unit when the user set one', () => {
    expect(formatHabitTarget({ measure: 'count', targetCount: 8, unit: 'glasses' })).toBe(
      '8 glasses',
    );
  });
});

describe('completion is the same arithmetic for every measure', () => {
  it('completes a step goal only once the target is reached', () => {
    expect(isHabitComplete({ count: 7999, targetCount: 8000 })).toBe(false);
    expect(isHabitComplete({ count: 8000, targetCount: 8000 })).toBe(true);
    expect(isHabitComplete({ count: 9200, targetCount: 8000 })).toBe(true);
  });
});

describe('measure specs', () => {
  /**
   * A step of 1 on a step goal would mean 8,000 taps to finish a walk. Any measure whose
   * default target is large must move in correspondingly large increments.
   */
  it('never needs more than 20 taps to reach the default goal', () => {
    for (const [name, spec] of Object.entries(HABIT_MEASURES)) {
      const taps = spec.defaultTarget / spec.step;
      expect(taps, `${name} needs ${taps} taps`).toBeLessThanOrEqual(20);
    }
  });

  it('keeps every default target inside its own bounds', () => {
    for (const [name, spec] of Object.entries(HABIT_MEASURES)) {
      expect(spec.defaultTarget, name).toBeGreaterThanOrEqual(spec.minTarget);
      expect(spec.defaultTarget, name).toBeLessThanOrEqual(spec.maxTarget);
    }
  });
});
