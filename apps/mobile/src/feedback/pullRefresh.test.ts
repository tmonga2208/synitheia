import { describe, expect, it } from 'vitest';
import { runPull } from './pullRefresh.js';

describe('runPull', () => {
  it('shows the spinner for the length of the refresh', async () => {
    const seen: string[] = [];
    let finish: () => void = () => undefined;
    const refresh = () =>
      new Promise<void>((resolve) => {
        seen.push('refresh started');
        finish = resolve;
      });

    const pull = runPull(refresh, (on) => seen.push(on ? 'on' : 'off'));
    expect(seen).toEqual(['on', 'refresh started']);

    finish();
    await pull;
    expect(seen).toEqual(['on', 'refresh started', 'off']);
  });

  it('stops the spinner when the refresh fails, and does not throw', async () => {
    const seen: boolean[] = [];

    await expect(
      runPull(
        () => Promise.reject(new Error('offline')),
        (on) => seen.push(on),
      ),
    ).resolves.toBeUndefined();

    expect(seen).toEqual([true, false]);
  });
});
