import { describe, expect, it } from 'vitest';
import { asLocalDate } from '../time/local-date.js';
import {
  ageOn,
  activityFactorFromSteps,
  bmi,
  bmiBand,
  bmr,
  bodyInsight,
  calorieTargetFor,
  tdee,
  type BodyMetrics,
} from './health.js';

const d = asLocalDate;

describe('ageOn', () => {
  it('counts whole years', () => {
    expect(ageOn(d('1990-06-15'), d('2026-06-15'))).toBe(36);
  });

  it('does not count a birthday that has not happened yet', () => {
    expect(ageOn(d('1990-06-15'), d('2026-06-14'))).toBe(35);
    expect(ageOn(d('1990-12-31'), d('2026-01-01'))).toBe(35);
  });

  it('handles a leap-day birthday without going backwards', () => {
    expect(ageOn(d('2000-02-29'), d('2026-02-28'))).toBe(25);
    expect(ageOn(d('2000-02-29'), d('2026-03-01'))).toBe(26);
  });
});

describe('bmi', () => {
  it('is weight over height squared, in metres', () => {
    expect(bmi(70, 175)).toBe(22.9);
  });

  it('bands on the WHO cut-offs', () => {
    expect(bmiBand(18.4)).toBe('underweight');
    expect(bmiBand(18.5)).toBe('healthy');
    expect(bmiBand(24.9)).toBe('healthy');
    expect(bmiBand(25)).toBe('overweight');
    expect(bmiBand(29.9)).toBe('overweight');
    expect(bmiBand(30)).toBe('obese');
  });
});

describe('bmr (Mifflin-St Jeor)', () => {
  it('matches the published formula for a man', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5
    expect(bmr({ weightKg: 80, heightCm: 180, biologicalSex: 'male', age: 30 })).toBe(1780);
  });

  it('matches the published formula for a woman', () => {
    // 10*60 + 6.25*165 - 5*30 - 161 = 600 + 1031.25 - 150 - 161
    expect(bmr({ weightKg: 60, heightCm: 165, biologicalSex: 'female', age: 30 })).toBe(1320);
  });

  it('averages the two constants for other, landing between them', () => {
    const male = bmr({ weightKg: 70, heightCm: 170, biologicalSex: 'male', age: 30 });
    const female = bmr({ weightKg: 70, heightCm: 170, biologicalSex: 'female', age: 30 });
    const other = bmr({ weightKg: 70, heightCm: 170, biologicalSex: 'other', age: 30 });

    expect(other).toBeGreaterThan(female);
    expect(other).toBeLessThan(male);
  });
});

describe('tdee', () => {
  /**
   * The point of reading Health at all. A measured active-energy figure beats any lifestyle
   * bracket the user could have picked off a dropdown.
   */
  it('prefers measured active energy over a step multiplier', () => {
    const result = tdee(1800, { activeEnergyKcal: 600, steps: 2000 });

    expect(result.kcal).toBe(2400); //  BMR + active energy, NOT BMR * 1.2
    expect(result.estimated).toBe(false);
  });

  it('falls back to steps when active energy is missing, and says it estimated', () => {
    const result = tdee(1800, { activeEnergyKcal: null, steps: 11_000 });

    expect(result.kcal).toBe(Math.round(1800 * 1.725));
    expect(result.estimated).toBe(true);
  });

  it('treats a zero active-energy reading as missing rather than as a sedentary truth', () => {
    // A watch that recorded nothing is not proof that you burned nothing above resting.
    expect(tdee(1800, { activeEnergyKcal: 0, steps: 11_000 }).estimated).toBe(true);
  });

  it('assumes sedentary when there is no data at all', () => {
    expect(activityFactorFromSteps(0)).toBe(1.2);
    expect(tdee(1800, {}).kcal).toBe(Math.round(1800 * 1.2));
  });
});

describe('calorieTargetFor', () => {
  const opts = { basal: 1500, biologicalSex: 'male' } as const;

  it('subtracts a deficit to lose and adds a surplus to gain', () => {
    expect(calorieTargetFor(2600, 'lose', opts).kcal).toBe(2100);
    expect(calorieTargetFor(2600, 'maintain', opts).kcal).toBe(2600);
    expect(calorieTargetFor(2600, 'gain', opts).kcal).toBe(2900);
  });

  /**
   * The safety property. The arithmetic will happily produce a harmful number for a small,
   * sedentary person; the floor is what stops the app from recommending it.
   */
  it('never recommends eating below BMR', () => {
    const target = calorieTargetFor(1700, 'lose', { basal: 1600, biologicalSex: 'female' });

    expect(target.kcal).toBe(1600); //  not 1200
    expect(target.floored).toBe(true);
  });

  it('never recommends eating below the absolute floor', () => {
    const target = calorieTargetFor(1500, 'lose', { basal: 1100, biologicalSex: 'female' });

    expect(target.kcal).toBe(1200); //  1000 would be the raw maths
    expect(target.floored).toBe(true);
  });

  it('does not claim to have floored a target it left alone', () => {
    expect(calorieTargetFor(2600, 'lose', opts).floored).toBe(false);
  });

  it('always reports maintenance, whatever the goal', () => {
    expect(calorieTargetFor(2600, 'lose', opts).maintenanceKcal).toBe(2600);
  });
});

describe('bodyInsight', () => {
  const today = d('2026-07-14');
  const full: BodyMetrics = {
    heightCm: 180,
    weightKg: 80,
    biologicalSex: 'male',
    birthDate: d('1996-07-14'),
  };

  it('derives everything when the body is fully known', () => {
    const insight = bodyInsight(full, { activeEnergyKcal: 500 }, today);

    expect(insight.missing).toEqual([]);
    expect(insight.bmi).toBe(24.7);
    expect(insight.bmiBand).toBe('healthy');
    expect(insight.bmrKcal).toBe(1780);
    expect(insight.tdee?.kcal).toBe(2280);
  });

  /**
   * The core refusal. Filling an unknown height with a population average would produce a
   * calorie target that LOOKS like an estimate but is a fabrication — and the user would
   * eat to it.
   */
  it('refuses to compute BMR when sex or birth date is unknown', () => {
    const insight = bodyInsight(
      { ...full, biologicalSex: null, birthDate: null },
      { activeEnergyKcal: 500 },
      today,
    );

    expect(insight.bmrKcal).toBeNull();
    expect(insight.tdee).toBeNull();
    expect(insight.missing).toEqual(['sex', 'birthDate']);
  });

  it('still gives BMI when only height and weight are known, since that is all BMI needs', () => {
    const insight = bodyInsight(
      { ...full, biologicalSex: null, birthDate: null },
      {},
      today,
    );

    expect(insight.bmi).toBe(24.7);
    expect(insight.bmiBand).toBe('healthy');
  });

  it('reports nothing derivable when Health held nothing', () => {
    const insight = bodyInsight(
      { heightCm: null, weightKg: null, biologicalSex: null, birthDate: null },
      {},
      today,
    );

    expect(insight.bmi).toBeNull();
    expect(insight.bmrKcal).toBeNull();
    expect(insight.missing).toEqual(['height', 'weight', 'sex', 'birthDate']);
  });
});
