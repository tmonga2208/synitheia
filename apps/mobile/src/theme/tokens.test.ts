import { describe, expect, it } from 'vitest';
import { flowTint, palette } from './tokens.js';

describe('flowTint', () => {
  it('gives a full day the solid sage anchor with white text', () => {
    expect(flowTint(100)).toEqual({ background: palette.sage, text: palette.white });
    expect(flowTint(85)).toEqual({ background: palette.sage, text: palette.white });
  });

  it('flips to white text only once the fill is dark enough to carry it', () => {
    expect(flowTint(70).text).toBe(palette.white);
    expect(flowTint(50).text).toBe(palette.stone);
  });

  it('gives a logged-but-zero day a visible fill, distinct from an empty cell', () => {
    const zero = flowTint(0);
    expect(zero.background).toBe(palette.sand);
    expect(zero.background).not.toBe('transparent');
  });

  it('is monotonic — a better day is never a lighter tint', () => {
    const steps = [0, 20, 45, 70, 95].map((p) => flowTint(p).background);
    expect(new Set(steps).size).toBe(5);
  });

  it('clamps out-of-range input rather than throwing', () => {
    expect(flowTint(-10)).toEqual(flowTint(0));
    expect(flowTint(999)).toEqual(flowTint(100));
  });
});
