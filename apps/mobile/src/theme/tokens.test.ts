import { describe, expect, it } from 'vitest';
import { flowTint, palette } from './tokens.js';

describe('flowTint', () => {
  it('gives a full day the solid sage anchor with white text', () => {
    expect(flowTint(100)).toEqual({ background: palette.sage, text: palette.white });
    expect(flowTint(85)).toEqual({ background: palette.sage, text: palette.white });
  });

  it('flips to white text only at the solid top step', () => {
    // Text transitions to white only at >= 85 (solid sage)
    expect(flowTint(85).text).toBe(palette.white);
    expect(flowTint(84).text).toBe(palette.stone);
    // All intermediate steps stay stone
    expect(flowTint(70).text).toBe(palette.stone);
    expect(flowTint(50).text).toBe(palette.stone);
    expect(flowTint(30).text).toBe(palette.stone);
  });

  it('gives a logged-but-zero day a visible fill, distinct from an empty cell', () => {
    const zero = flowTint(0);
    expect(zero.background).toBe(palette.sand);
    expect(zero.background).not.toBe('transparent');
  });

  it('is monotonic — a better day is never a lighter tint', () => {
    // Test exact boundaries and assert ordering by alpha values and solid top step
    const band15 = flowTint(15).background; // >= 15: rgba(125, 146, 125, 0.24)
    const band40 = flowTint(40).background; // >= 40: rgba(125, 146, 125, 0.46)
    const band65 = flowTint(65).background; // >= 65: rgba(125, 146, 125, 0.74)
    const band85 = flowTint(85).background; // >= 85: solid sage

    // Verify alpha values ascend across RGBA steps
    expect(band15).toBe('rgba(125, 146, 125, 0.24)');
    expect(band40).toBe('rgba(125, 146, 125, 0.46)');
    expect(band65).toBe('rgba(125, 146, 125, 0.74)');
    // Top step is solid sage (darkest)
    expect(band85).toBe(palette.sage);
    expect(band85).not.toMatch(/rgba/);
  });

  it('clamps out-of-range input rather than throwing', () => {
    expect(flowTint(-10)).toEqual(flowTint(0));
    expect(flowTint(999)).toEqual(flowTint(100));
  });

  it('pins exact thresholds — boundaries fall where specified', () => {
    // 84 vs 85: the text-flip boundary (stone vs. white)
    expect(flowTint(84)).toEqual({ background: 'rgba(125, 146, 125, 0.74)', text: palette.stone });
    expect(flowTint(85)).toEqual({ background: palette.sage, text: palette.white });

    // 64 vs 65: the band boundary (0.46 alpha vs 0.74 alpha)
    expect(flowTint(64).background).toBe('rgba(125, 146, 125, 0.46)');
    expect(flowTint(65).background).toBe('rgba(125, 146, 125, 0.74)');

    // 39 vs 40: the band boundary (0.24 alpha vs 0.46 alpha)
    expect(flowTint(39).background).toBe('rgba(125, 146, 125, 0.24)');
    expect(flowTint(40).background).toBe('rgba(125, 146, 125, 0.46)');

    // 14 vs 15: the band boundary (sand vs 0.24 alpha)
    expect(flowTint(14).background).toBe(palette.sand);
    expect(flowTint(15).background).toBe('rgba(125, 146, 125, 0.24)');
  });
});
