import { describe, expect, it } from 'vitest';
import type { LocalDate } from '../time/local-date.js';
import { goalPace, retargetForWeight, weeklyChangeKg } from './weight.js';

const d = (s: string) => s as LocalDate;

describe('weeklyChangeKg', () => {
  it('compares the latest weight with the one about a week before it', () => {
    const entries = [
      { localDate: d('2026-10-01'), weightKg: 74 },
      { localDate: d('2026-10-21'), weightKg: 73.2 },
      { localDate: d('2026-10-24'), weightKg: 73 },
      { localDate: d('2026-10-28'), weightKg: 72.6 },
    ];
    expect(weeklyChangeKg(entries)).toBe(-0.6);
  });

  it('has nothing to say without a weight at least five days older', () => {
    expect(weeklyChangeKg([{ localDate: d('2026-10-28'), weightKg: 72.6 }])).toBeNull();
    expect(
      weeklyChangeKg([
        { localDate: d('2026-10-26'), weightKg: 73 },
        { localDate: d('2026-10-28'), weightKg: 72.6 },
      ]),
    ).toBeNull();
  });

  it('turns a gap into a per-week rate rather than a total', () => {
    const entries = [
      { localDate: d('2026-10-14'), weightKg: 74 },
      { localDate: d('2026-10-28'), weightKg: 73 },
    ];
    expect(weeklyChangeKg(entries)).toBe(-0.5);
  });
});

describe('goalPace', () => {
  it('reads a loss of half a kilo a week as on track for losing weight', () => {
    expect(goalPace('lose', -0.5)).toBe('on_track');
  });

  it('flags losing faster than a kilo a week', () => {
    expect(goalPace('lose', -1.3)).toBe('fast');
  });

  it('says when the weight is holding, or moving the wrong way', () => {
    expect(goalPace('lose', 0.05)).toBe('steady');
    expect(goalPace('lose', 0.4)).toBe('opposite');
    expect(goalPace('gain', -0.3)).toBe('opposite');
  });

  it('treats small drift as on track when the goal is to stay put', () => {
    expect(goalPace('maintain', 0.3)).toBe('on_track');
    expect(goalPace('maintain', -0.8)).toBe('drifting');
  });
});

describe('retargetForWeight', () => {
  const body = { heightCm: 175, biologicalSex: 'male' as const, age: 30 };

  it('lowers the target as weight comes off, keeping the goal and the activity level', () => {
    // BMR is 1,749 at 80 kg and 1,729 at 78 kg; maintenance scales with it.
    const next = retargetForWeight({
      goal: 'lose',
      maintenanceKcal: 2670,
      fromKg: 80,
      toKg: 78,
      ...body,
    });
    expect(next.maintenanceKcal).toBe(2639);
    expect(next.target.kcal).toBe(2139);
  });

  it('leaves the target alone when the weight has not changed', () => {
    const next = retargetForWeight({
      goal: 'maintain',
      maintenanceKcal: 2400,
      fromKg: 80,
      toKg: 80,
      ...body,
    });
    expect(next.target.kcal).toBe(2400);
  });

  it('never goes under what the body burns at rest, however much is lost', () => {
    const next = retargetForWeight({
      goal: 'lose',
      maintenanceKcal: 1700,
      fromKg: 60,
      toKg: 55,
      heightCm: 160,
      biologicalSex: 'female',
      age: 30,
    });
    // 1,634 − 500 would be 1,134; resting burn at 55 kg is 1,239.
    expect(next.target.kcal).toBe(1239);
    expect(next.target.floored).toBe(true);
  });
});
