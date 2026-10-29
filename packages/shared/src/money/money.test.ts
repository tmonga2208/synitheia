import { describe, expect, it } from 'vitest';
import {
  asMinor,
  formatMoney,
  formatMoneyCompact,
  isSupportedCurrency,
  netSpend,
  parseMoneyInput,
  percentChange,
  splitEvenly,
  sumMoney,
} from './money.js';

describe('asMinor', () => {
  it('accepts integers', () => {
    expect(asMinor(25000)).toBe(25000);
    expect(asMinor(0)).toBe(0);
    expect(asMinor(-500)).toBe(-500);
  });

  it('rejects floats — the entire point of the type', () => {
    expect(() => asMinor(250.5)).toThrow(RangeError);
    expect(() => asMinor(0.1 + 0.2)).toThrow(RangeError);
  });

  it('rejects unsafe integers', () => {
    expect(() => asMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('parseMoneyInput', () => {
  it('parses whole rupees', () => {
    expect(parseMoneyInput('250', 'INR')).toBe(25000);
  });

  it('parses decimals', () => {
    expect(parseMoneyInput('12.50', 'INR')).toBe(1250);
    expect(parseMoneyInput('12.5', 'INR')).toBe(1250);
    expect(parseMoneyInput('0.01', 'INR')).toBe(1);
  });

  it('strips symbols and separators', () => {
    expect(parseMoneyInput('₹1,234.50', 'INR')).toBe(123450);
    expect(parseMoneyInput('$99.99', 'USD')).toBe(9999);
  });

  it('does not lose precision the way floats do', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004. In minor units it is exactly 30.
    const a = parseMoneyInput('0.10', 'INR');
    const b = parseMoneyInput('0.20', 'INR');
    expect(sumMoney([a!, b!])).toBe(30);
    expect(formatMoney(sumMoney([a!, b!]), 'INR')).toBe('₹0.30');
  });

  it('respects zero-decimal currencies', () => {
    expect(parseMoneyInput('500', 'JPY')).toBe(500);
    expect(parseMoneyInput('500.5', 'JPY')).toBeNull(); // JPY has no minor unit
  });

  it('rejects more precision than the currency supports', () => {
    expect(parseMoneyInput('12.345', 'INR')).toBeNull();
  });

  it('returns null for partial input rather than throwing', () => {
    expect(parseMoneyInput('', 'INR')).toBeNull();
    expect(parseMoneyInput('.', 'INR')).toBeNull();
    expect(parseMoneyInput('-', 'INR')).toBeNull();
    expect(parseMoneyInput('abc', 'INR')).toBeNull();
    expect(parseMoneyInput('1.2.3', 'INR')).toBeNull();
  });

  it('handles a bare decimal point prefix', () => {
    expect(parseMoneyInput('.50', 'INR')).toBe(50);
  });

  it('handles negatives (refunds)', () => {
    expect(parseMoneyInput('-250', 'INR')).toBe(-25000);
  });
});

describe('formatMoney', () => {
  it('formats INR with the Indian grouping system', () => {
    // en-IN groups as 1,23,456 — not 123,456.
    expect(formatMoney(asMinor(12345600), 'INR')).toBe('₹1,23,456.00');
  });

  it('formats USD', () => {
    expect(formatMoney(asMinor(9999), 'USD')).toBe('$99.99');
  });

  it('formats zero-decimal currencies without a fraction', () => {
    expect(formatMoney(asMinor(500), 'JPY')).toBe('￥500');
  });

  it('round-trips through parseMoneyInput', () => {
    for (const input of ['250', '12.50', '1,234.50', '0.01']) {
      const minor = parseMoneyInput(input, 'INR')!;
      const reparsed = parseMoneyInput(formatMoney(minor, 'INR'), 'INR');
      expect(reparsed).toBe(minor);
    }
  });
});

describe('formatMoneyCompact', () => {
  it('uses lakh notation for INR', () => {
    expect(formatMoneyCompact(asMinor(48200000), 'INR')).toBe('₹4.8L');
  });

  it('uses K notation for USD', () => {
    expect(formatMoneyCompact(asMinor(120000), 'USD')).toBe('$1.2K');
  });

  it('drops a trailing .0 and keeps small amounts whole', () => {
    expect(formatMoneyCompact(asMinor(2200000), 'INR')).toBe('₹22K');
    expect(formatMoneyCompact(asMinor(35900), 'INR')).toBe('₹359');
    expect(formatMoneyCompact(asMinor(1500000000), 'INR')).toBe('₹1.5Cr');
    expect(formatMoneyCompact(asMinor(250000000), 'USD')).toBe('$2.5M');
  });

  // Hermes, the engine the app runs on, ignores Intl's compact notation and printed
  // "₹22,000.0" on the phone while these tests passed in Node.
  it('does not depend on Intl compact notation', () => {
    const Original = Intl.NumberFormat;
    const spy = function (this: unknown, locale?: string, options?: Intl.NumberFormatOptions) {
      if (options?.notation === 'compact') throw new Error('compact notation used');
      return new Original(locale, options);
    } as unknown as typeof Intl.NumberFormat;
    Intl.NumberFormat = spy;
    try {
      expect(formatMoneyCompact(asMinor(2200000), 'INR')).toBe('₹22K');
    } finally {
      Intl.NumberFormat = Original;
    }
  });
});

describe('sumMoney', () => {
  it('sums exactly', () => {
    expect(sumMoney([asMinor(25000), asMinor(32000), asMinor(1250)])).toBe(58250);
  });

  it('sums an empty list to zero', () => {
    expect(sumMoney([])).toBe(0);
  });
});

describe('percentChange', () => {
  it('computes the increase in the brief example (₹3610 → ₹4820 ≈ +34%)', () => {
    expect(percentChange(asMinor(482000), asMinor(361000))).toBe(34);
  });

  it('computes decreases', () => {
    expect(percentChange(asMinor(50000), asMinor(100000))).toBe(-50);
  });

  it('returns null when the baseline is zero rather than fabricating a percentage', () => {
    // An insight that says "your food spending is up 100%" when it went ₹0 → ₹500
    // is misleading. The caller must phrase this case differently.
    expect(percentChange(asMinor(50000), asMinor(0))).toBeNull();
  });

  it('reports no change as 0', () => {
    expect(percentChange(asMinor(50000), asMinor(50000))).toBe(0);
  });
});

describe('isSupportedCurrency', () => {
  it('gates unknown codes', () => {
    expect(isSupportedCurrency('INR')).toBe(true);
    expect(isSupportedCurrency('XYZ')).toBe(false);
  });
});

describe('splitEvenly', () => {
  it('splits cleanly when it divides', () => {
    expect(splitEvenly(asMinor(90000), 3)).toEqual([30000, 30000, 30000]);
  });

  /**
   * The whole reason this function exists. ₹1,000 ÷ 3 = 33,333.33 paise, which is not a
   * thing. Naive rounding either destroys a paise or conjures one, and then the split
   * no longer sums to the bill — a settle-up screen built on that never balances.
   */
  it('never loses or invents a paise when it does not divide', () => {
    const shares = splitEvenly(asMinor(100000), 3); // ₹1,000 three ways
    expect(shares).toEqual([33334, 33333, 33333]);
    expect(sumMoney(shares)).toBe(100000);
  });

  it('always sums exactly to the total, for every awkward case', () => {
    for (const total of [1, 7, 99, 100, 12345, 100000, 999999]) {
      for (const ways of [1, 2, 3, 4, 5, 6, 7, 11, 13]) {
        const shares = splitEvenly(asMinor(total), ways);
        expect(shares).toHaveLength(ways);
        expect(sumMoney(shares)).toBe(total);
      }
    }
  });

  it('distributes the remainder rather than dumping it on one person', () => {
    // ₹0.10 between 3 = 4p, 3p, 3p — not 10p, 0p, 0p.
    expect(splitEvenly(asMinor(10), 3)).toEqual([4, 3, 3]);
    // Nobody is more than one minor unit worse off than anybody else.
    const shares = splitEvenly(asMinor(100), 7);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it('handles a one-way split (nobody else was there)', () => {
    expect(splitEvenly(asMinor(25000), 1)).toEqual([25000]);
  });

  it('handles splitting zero', () => {
    expect(splitEvenly(asMinor(0), 4)).toEqual([0, 0, 0, 0]);
  });

  it('rejects a nonsense number of ways', () => {
    expect(() => splitEvenly(asMinor(100), 0)).toThrow(RangeError);
    expect(() => splitEvenly(asMinor(100), -1)).toThrow(RangeError);
  });
});

describe('netSpend', () => {
  it('is what you paid minus what came back', () => {
    // Paid ₹1,000, three friends settled ₹250 each.
    expect(netSpend(asMinor(100000), asMinor(75000))).toBe(25000);
  });

  it('is the full amount when nobody has settled', () => {
    expect(netSpend(asMinor(100000), asMinor(0))).toBe(100000);
  });

  it('never goes negative — an overpayment is not a negative lunch', () => {
    expect(netSpend(asMinor(100000), asMinor(120000))).toBe(0);
  });
});
