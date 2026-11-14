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

  it('draws a full ring as one unbroken loop, with no ends to meet', () => {
    // Shortened like a partial arc, the two rounded ends met head to head at 12 o'clock
    // and left a pinched notch between them: a ring with "sides", not a circle.
    expect(ringArc(1, C, W)).toEqual({ offset: 0, visible: true });
  });

  it('still leaves the gap just short of 100%', () => {
    // 99% of 1000 is 990; less the two caps, the line is 974.
    expect(ringArc(0.99, C, W)).toEqual({ offset: 26, visible: true });
  });

  it('keeps a tiny progress as a single round dot, never a negative line', () => {
    expect(ringArc(0.005, C, W)).toEqual({ offset: C, visible: true });
  });
});
