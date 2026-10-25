import { describe, expect, it } from 'vitest';
import { monthSpentLine } from './monthTotal.js';

describe('monthSpentLine', () => {
  it("says what the month cost", () => {
    expect(monthSpentLine({ totalMinor: 482050, count: 70 }, 'INR')).toBe('₹4,820.50 spent');
  });

  it('says nothing for a month with nothing in it, which the empty state already covers', () => {
    expect(monthSpentLine({ totalMinor: 0, count: 0 }, 'INR')).toBeNull();
  });

  it('says nothing until the total has loaded', () => {
    expect(monthSpentLine(undefined, 'INR')).toBeNull();
  });
});
