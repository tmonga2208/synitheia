import { describe, expect, it } from 'vitest';
import { flowTint, palette } from './tokens.js';

/** WCAG 2.1 relative luminance, so "darker" is asserted rather than eyeballed. */
function relativeLuminance(hex: string): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('flowTint', () => {
  it('gives the top band the best contrast available, though still short of 4.5:1', () => {
    const top = flowTint(90);
    const ratio = contrastRatio(top.background, top.text);

    // 4.31:1. Not AA for normal text — recorded here so a future "improvement" back to
    // palette.sage (3.34:1) is a failing test rather than a silent regression.
    expect(ratio).toBeGreaterThan(4.3);
    expect(ratio).toBeGreaterThan(contrastRatio(palette.sage, palette.white));
  });

  it('gives a full day the solid sageDeep anchor with white text', () => {
    // sageDeep, not sage: the date numerals are `caption` (12px), which WCAG 1.4.3
    // counts as normal text at 4.5:1. White on sage measures 3.34:1 and fails; white
    // on sageDeep measures 4.31:1, the best any fill in this ramp reaches.
    expect(flowTint(100)).toEqual({ background: palette.sageDeep, text: palette.white });
    expect(flowTint(85)).toEqual({ background: palette.sageDeep, text: palette.white });
  });

  it('flips to white text only at the solid top step', () => {
    // Text transitions to white only at >= 85 (solid sageDeep)
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
    const band85 = flowTint(85).background; // >= 85: solid sageDeep

    // Verify alpha values ascend across RGBA steps
    expect(band15).toBe('rgba(125, 146, 125, 0.24)');
    expect(band40).toBe('rgba(125, 146, 125, 0.46)');
    expect(band65).toBe('rgba(125, 146, 125, 0.74)');
    // Top step is solid sageDeep — darker than sage, so replacing sage with it at the
    // top keeps the ramp monotonic rather than flattening it.
    expect(band85).toBe(palette.sageDeep);
    expect(band85).not.toMatch(/rgba/);
    expect(relativeLuminance(palette.sageDeep)).toBeLessThan(relativeLuminance(palette.sage));
  });

  it('clamps out-of-range input rather than throwing', () => {
    expect(flowTint(-10)).toEqual(flowTint(0));
    expect(flowTint(999)).toEqual(flowTint(100));
  });

  it('pins exact thresholds — boundaries fall where specified', () => {
    // 84 vs 85: the text-flip boundary (stone vs. white)
    expect(flowTint(84)).toEqual({ background: 'rgba(125, 146, 125, 0.74)', text: palette.stone });
    expect(flowTint(85)).toEqual({ background: palette.sageDeep, text: palette.white });

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
