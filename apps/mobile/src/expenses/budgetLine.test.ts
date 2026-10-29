import { describe, expect, it } from 'vitest';
import { budgetLine } from './budgetLine.js';

describe('budgetLine', () => {
  it('says how far over the budget the month went', () => {
    const line = budgetLine(5_173_300, 4_500_000, 'INR');
    expect(line?.over).toBe(true);
    expect(line?.text).toMatch(/over your .*45.* budget/);
  });

  it('says what is left while under the budget', () => {
    const line = budgetLine(1_000_000, 4_500_000, 'INR');
    expect(line?.over).toBe(false);
    expect(line?.text).toMatch(/left of your .*45.* budget/);
  });

  it('is null without a budget', () => {
    expect(budgetLine(1_000_000, null, 'INR')).toBeNull();
  });
});
