import { describe, expect, it } from 'vitest';
import { parseMoneyInput } from '@synitheia/shared';
import { budgetInputValue } from './budgetInput.js';

describe('budgetInputValue', () => {
  it('writes a whole budget without paise, grouped the way the currency is read', () => {
    expect(budgetInputValue(4_500_000, 'INR')).toBe('45,000');
    expect(budgetInputValue(15_000_000, 'INR')).toBe('1,50,000');
    expect(budgetInputValue(250_000, 'USD')).toBe('2,500');
  });

  it('keeps the paise of a budget that has some', () => {
    expect(budgetInputValue(4_500_050, 'INR')).toBe('45,000.50');
  });

  it('is empty when no budget is set', () => {
    expect(budgetInputValue(null, 'INR')).toBe('');
  });

  it('reads back as the amount it came from when saved untouched', () => {
    for (const minor of [4_500_000, 4_500_050, 15_000_000, 99]) {
      expect(parseMoneyInput(budgetInputValue(minor, 'INR'), 'INR')).toBe(minor);
    }
  });
});
