import { describe, expect, it } from 'vitest';
import { parseMoneyInput } from '@synitheia/shared';
import { moneyInputValue } from './moneyInput.js';

describe('moneyInputValue', () => {
  it('writes a whole amount without paise, grouped the way the currency is read', () => {
    expect(moneyInputValue(4_500_000, 'INR')).toBe('45,000');
    expect(moneyInputValue(15_000_000, 'INR')).toBe('1,50,000');
    expect(moneyInputValue(250_000, 'USD')).toBe('2,500');
  });

  it('keeps the paise of an amount that has some', () => {
    expect(moneyInputValue(4_500_050, 'INR')).toBe('45,000.50');
  });

  it('is empty when there is no amount', () => {
    expect(moneyInputValue(null, 'INR')).toBe('');
  });

  it('reads back as the amount it came from when saved untouched', () => {
    for (const minor of [4_500_000, 4_500_050, 15_000_000, 99]) {
      expect(parseMoneyInput(moneyInputValue(minor, 'INR'), 'INR')).toBe(minor);
    }
  });
});
