import { describe, expect, it } from 'vitest';
import { mapLimit } from './mapLimit.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('mapLimit', () => {
  it('keeps the results in the order of the inputs', async () => {
    const out = await mapLimit([30, 10, 20], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });

    expect(out).toEqual([30, 10, 20]);
  });

  it('never runs more than the limit at once', async () => {
    let running = 0;
    let most = 0;

    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      running += 1;
      most = Math.max(most, running);
      await tick();
      running -= 1;
    });

    expect(most).toBe(4);
  });

  it('fails with the first error', async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('two');
        return n;
      }),
    ).rejects.toThrow('two');
  });
});
