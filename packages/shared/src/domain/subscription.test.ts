import { describe, expect, it } from 'vitest';
import { asLocalDate, type LocalDate } from '../time/local-date.js';
import { dueDateIn, monthlyEquivalent, nextDueAfter } from './subscription.js';

const d = (s: string): LocalDate => asLocalDate(s);

describe('dueDateIn', () => {
  it('uses the anchor day when the month has it', () => {
    expect(dueDateIn(2026, 1, 15)).toBe('2026-01-15');
    expect(dueDateIn(2026, 1, 31)).toBe('2026-01-31');
  });

  it('clamps to the last day when the month is short', () => {
    expect(dueDateIn(2026, 2, 31)).toBe('2026-02-28'); // Feb, not a leap year
    expect(dueDateIn(2026, 4, 31)).toBe('2026-04-30'); // April has 30
  });

  it('knows about leap years', () => {
    expect(dueDateIn(2024, 2, 31)).toBe('2024-02-29');
    expect(dueDateIn(2024, 2, 30)).toBe('2024-02-29');
    expect(dueDateIn(2100, 2, 31)).toBe('2100-02-28'); // divisible by 100, not a leap year
  });
});

describe('nextDueAfter — monthly', () => {
  it('finds the next occurrence in the same month', () => {
    expect(nextDueAfter(d('2026-03-05'), 'monthly', 15, null)).toBe('2026-03-15');
  });

  it('rolls into next month when the anchor has passed', () => {
    expect(nextDueAfter(d('2026-03-20'), 'monthly', 15, null)).toBe('2026-04-15');
  });

  it('is strictly after — the due date itself advances', () => {
    expect(nextDueAfter(d('2026-03-15'), 'monthly', 15, null)).toBe('2026-04-15');
  });

  it('crosses a year boundary', () => {
    expect(nextDueAfter(d('2026-12-20'), 'monthly', 15, null)).toBe('2027-01-15');
  });

  /**
   * THE bug this whole module exists to prevent.
   *
   * A subscription anchored on the 31st must clamp to Feb 28 — and then RETURN to the
   * 31st in March. Code that computes the next date from the *previous due date* clamps
   * once and drifts forever: 31 Jan → 28 Feb → 28 Mar → 28 Apr. By summer the user is
   * being billed on a day they never chose, and nobody can explain why.
   */
  it('clamps a 31st anchor into February and then RETURNS to the 31st', () => {
    const jan = nextDueAfter(d('2026-01-01'), 'monthly', 31, null);
    expect(jan).toBe('2026-01-31');

    const feb = nextDueAfter(jan, 'monthly', 31, null);
    expect(feb).toBe('2026-02-28'); // clamped

    const mar = nextDueAfter(feb, 'monthly', 31, null);
    expect(mar).toBe('2026-03-31'); // <- back to the 31st. NOT the 28th.

    const apr = nextDueAfter(mar, 'monthly', 31, null);
    expect(apr).toBe('2026-04-30'); // April has 30 days

    const may = nextDueAfter(apr, 'monthly', 31, null);
    expect(may).toBe('2026-05-31'); // <- and back again
  });

  it('does not drift across a full year of a 31st anchor', () => {
    let date = d('2026-01-31');
    const seen: string[] = [date];

    for (let i = 0; i < 11; i++) {
      date = nextDueAfter(date, 'monthly', 31, null);
      seen.push(date);
    }

    expect(seen).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]);
  });

  it('handles a 29th anchor through a leap February', () => {
    expect(nextDueAfter(d('2024-01-30'), 'monthly', 29, null)).toBe('2024-02-29');
    expect(nextDueAfter(d('2026-01-30'), 'monthly', 29, null)).toBe('2026-02-28');
  });
});

describe('nextDueAfter — weekly', () => {
  // 2026-07-14 is a Tuesday. Weekday index: 0 = Monday.
  it('finds the next matching weekday', () => {
    expect(nextDueAfter(d('2026-07-14'), 'weekly', 4, null)).toBe('2026-07-17'); // Friday
  });

  it('advances a full week when today IS the anchor weekday', () => {
    // Never returns the same day — the bill would post twice.
    expect(nextDueAfter(d('2026-07-14'), 'weekly', 1, null)).toBe('2026-07-21');
  });

  it('wraps across the week boundary', () => {
    expect(nextDueAfter(d('2026-07-17'), 'weekly', 0, null)).toBe('2026-07-20'); // Fri → Mon
  });
});

describe('nextDueAfter — yearly and quarterly', () => {
  it('finds a yearly bill in its anchor month', () => {
    expect(nextDueAfter(d('2026-03-01'), 'yearly', 15, 6)).toBe('2026-06-15');
  });

  it('rolls a yearly bill into next year once it has passed', () => {
    expect(nextDueAfter(d('2026-07-01'), 'yearly', 15, 6)).toBe('2027-06-15');
  });

  it('clamps a yearly bill anchored on the 31st of a 30-day month', () => {
    expect(nextDueAfter(d('2026-01-01'), 'yearly', 31, 4)).toBe('2026-04-30');
  });

  it('steps a quarterly bill by three months', () => {
    expect(nextDueAfter(d('2026-01-20'), 'quarterly', 10, 1)).toBe('2026-04-10');
    expect(nextDueAfter(d('2026-04-20'), 'quarterly', 10, 1)).toBe('2026-07-10');
  });
});

describe('monthlyEquivalent', () => {
  it('leaves a monthly bill alone', () => {
    expect(monthlyEquivalent(64900, 'monthly')).toBe(64900);
  });

  /**
   * 52 weeks a year, not 48. Treating a month as "4 weeks" under-reports the annual
   * cost by a full month — a ₹200/week coffee is ₹10,400 a year, not ₹9,600.
   */
  it('converts weekly using 52/12, not a fictional 4-week month', () => {
    expect(monthlyEquivalent(20000, 'weekly')).toBe(86667); // 200 × 52 / 12 = 866.67
    expect(monthlyEquivalent(20000, 'weekly')).not.toBe(80000); // what 4 weeks would give
  });

  it('divides yearly by twelve', () => {
    expect(monthlyEquivalent(120000, 'yearly')).toBe(10000);
  });

  it('divides quarterly by three', () => {
    expect(monthlyEquivalent(90000, 'quarterly')).toBe(30000);
  });

  it('always returns whole minor units — no fractional paise', () => {
    for (const cycle of ['weekly', 'monthly', 'quarterly', 'yearly'] as const) {
      for (const amount of [1, 99, 64900, 123457]) {
        expect(Number.isInteger(monthlyEquivalent(amount, cycle))).toBe(true);
      }
    }
  });
});
