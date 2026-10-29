import { describe, expect, it } from 'vitest';
import { SPLASH_ARCS, arcDash } from './splashLogo.js';

describe('splash logo', () => {
  it('draws the swept part of the circle and leaves the rest empty', () => {
    const [drawn, gap] = arcDash(100, 90).split(' ').map(Number);
    expect(drawn! + gap!).toBeCloseTo(2 * Math.PI * 100);
    expect(drawn).toBeCloseTo(Math.PI * 50);
  });

  it('lists the arcs innermost first, as they spin', () => {
    const radii = SPLASH_ARCS.map((a) => a.radius);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
  });
});
