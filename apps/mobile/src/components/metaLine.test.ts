import { describe, expect, it } from 'vitest';
import { fitsOnOneLine } from './metaLine.js';

describe('fitsOnOneLine', () => {
  it('fits two facts and the separator between them', () => {
    // "Daily" • "10-day streak"
    expect(fitsOnOneLine(195, [30, 80], 15)).toBe(true);
  });

  it('does not fit a long count beside a streak', () => {
    // "6,849 / 8,000 steps" • "5-day streak" in the space beside the button
    expect(fitsOnOneLine(195, [122, 76], 15)).toBe(false);
  });

  it('fits a line exactly as wide as the box, and not one point wider', () => {
    expect(fitsOnOneLine(200, [100, 85], 15)).toBe(true);
    expect(fitsOnOneLine(199, [100, 85], 15)).toBe(false);
  });

  it('asks for no separator around a fact that is not there', () => {
    expect(fitsOnOneLine(100, [100, 0], 15)).toBe(true);
    expect(fitsOnOneLine(100, [100], 15)).toBe(true);
  });
});
