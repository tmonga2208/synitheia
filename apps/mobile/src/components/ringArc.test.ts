import { describe, expect, it } from 'vitest';
import { ringArc } from './ringArc.js';

const C = 1000;
const W = 16;

describe('ringArc', () => {
  it('draws nothing at all at 0%', () => {
    expect(ringArc(0, C, W).visible).toBe(false);
  });

  it('shortens the line by one stroke so the rounded ends land on the true start and end', () => {
    // 30% of 1000 is 300; the caps add 8 at each end, so the line itself is 284.
    expect(ringArc(0.3, C, W)).toEqual({ offset: 716, visible: true });
  });

  it('closes the circle at 100% without the ends overlapping', () => {
    expect(ringArc(1, C, W).offset).toBe(W);
  });

  it('keeps a tiny progress as a single round dot, never a negative line', () => {
    expect(ringArc(0.005, C, W)).toEqual({ offset: C, visible: true });
  });
});
