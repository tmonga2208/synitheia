import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, relativeLuminance } from './contrast.js';

describe('relativeLuminance', () => {
  it('is 1 for white and 0 for black', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('accepts shorthand and lowercase hex', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#7D927D', '#7D927D')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#15171A', '#E6E9EC')).toBeCloseTo(
      contrastRatio('#E6E9EC', '#15171A'),
      6,
    );
  });

  it("measures the app's known sage pairing", () => {
    // White on sage. Recorded in the History calendar's run notes at 3.34:1 —
    // this test is where that number stops being folklore.
    expect(contrastRatio('#FFFFFF', '#7D927D')).toBeCloseTo(3.34, 1);
  });
});

describe('composite', () => {
  it('returns the background at zero alpha', () => {
    expect(composite('#FFFFFF', 0, '#15171A').toUpperCase()).toBe('#15171A');
  });

  it('returns the foreground at full alpha', () => {
    expect(composite('#FFFFFF', 1, '#15171A').toUpperCase()).toBe('#FFFFFF');
  });

  it('blends halfway', () => {
    expect(composite('#FFFFFF', 0.5, '#000000').toUpperCase()).toBe('#808080');
  });
});
