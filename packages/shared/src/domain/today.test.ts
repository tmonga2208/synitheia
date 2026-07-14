import { describe, expect, it } from 'vitest';
import { computeDailyFlow, greetingFor, type FlowComponent } from './today.js';

const c = (
  key: FlowComponent['key'],
  percent: number,
  active = true,
): FlowComponent => ({ key, percent, active });

describe('computeDailyFlow', () => {
  it('is zero when the user tracks nothing yet', () => {
    // The empty-state home screen in the design shows 0%.
    expect(computeDailyFlow([]).percent).toBe(0);
    expect(computeDailyFlow([c('habits', 0, false)]).percent).toBe(0);
  });

  it('averages the active trackers', () => {
    const r = computeDailyFlow([c('habits', 100), c('water', 50)]);
    expect(r.percent).toBe(75);
  });

  it('lets a user who only tracks habits reach 100%', () => {
    // This is the whole point. Someone who has never opened the food tracker must
    // not be permanently capped below 100% by it — a ring that cannot be filled is
    // a ring that quietly tells the user they are failing.
    const r = computeDailyFlow([
      c('habits', 100),
      c('water', 0, false),
      c('nutrition', 0, false),
    ]);
    expect(r.percent).toBe(100);
    expect(r.components).toHaveLength(1);
  });

  it('reproduces the 100% state from the design reference', () => {
    const r = computeDailyFlow([c('habits', 100), c('water', 100), c('nutrition', 100)]);
    expect(r.percent).toBe(100);
  });

  it('weights active components evenly and reports the weights', () => {
    const r = computeDailyFlow([c('habits', 90), c('water', 60), c('nutrition', 30)]);
    expect(r.percent).toBe(60);
    expect(r.components.every((x) => Math.abs(x.weight - 1 / 3) < 1e-9)).toBe(true);
  });

  it('clamps over-achievement rather than exceeding 100%', () => {
    // Drinking 4L against a 2.5L target is 160% — the ring still stops at full.
    const r = computeDailyFlow([c('water', 160)]);
    expect(r.percent).toBe(100);
    expect(r.components[0]!.percent).toBe(100);
  });

  it('clamps negatives', () => {
    expect(computeDailyFlow([c('habits', -20)]).percent).toBe(0);
  });

  it('never returns NaN', () => {
    for (const r of [
      computeDailyFlow([]),
      computeDailyFlow([c('water', 0)]),
      computeDailyFlow([c('habits', 0, false), c('water', 0, false)]),
    ]) {
      expect(Number.isNaN(r.percent)).toBe(false);
    }
  });
});

describe('greetingFor', () => {
  it('matches the design copy across the day', () => {
    expect(greetingFor(0)).toBe('Good morning'); // midnight
    expect(greetingFor(8 * 60)).toBe('Good morning'); // 8am — the screenshot
    expect(greetingFor(11 * 60 + 59)).toBe('Good morning');
    expect(greetingFor(12 * 60)).toBe('Good afternoon');
    expect(greetingFor(16 * 60 + 59)).toBe('Good afternoon');
    expect(greetingFor(17 * 60)).toBe('Good evening');
    expect(greetingFor(23 * 60 + 59)).toBe('Good evening');
  });
});
