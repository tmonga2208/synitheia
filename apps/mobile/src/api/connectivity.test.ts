import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ConnectivityModule from './connectivity.js';
import type * as ReactQuery from '@tanstack/react-query';

let connectivity: typeof ConnectivityModule;
let onlineManager: typeof ReactQuery.onlineManager;
let stop: () => void;
const probe = vi.fn<() => Promise<boolean>>();

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  ({ onlineManager } = await import('@tanstack/react-query'));
  connectivity = await import('./connectivity.js');
  onlineManager.setOnline(true);
  probe.mockReset().mockResolvedValue(false);
  stop = connectivity.startConnectivity(probe);
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('connectivity', () => {
  it('goes offline when a request cannot connect', () => {
    connectivity.noteNetworkFailure();

    expect(onlineManager.isOnline()).toBe(false);
  });

  it('checks every five seconds while offline, and comes back when the server answers', async () => {
    connectivity.noteNetworkFailure();

    await vi.advanceTimersByTimeAsync(5000);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onlineManager.isOnline()).toBe(false);

    probe.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onlineManager.isOnline()).toBe(true);

    // Back online: no more checking.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('comes back at once when any request gets an answer', async () => {
    connectivity.noteNetworkFailure();
    connectivity.noteNetworkSuccess();

    expect(onlineManager.isOnline()).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(probe).not.toHaveBeenCalled();
  });

  it('checks straight away when asked, as when the app returns to the front', async () => {
    connectivity.noteNetworkFailure();
    probe.mockResolvedValue(true);

    await connectivity.checkConnectivityNow();

    expect(onlineManager.isOnline()).toBe(true);
  });

  it('does not check while online', async () => {
    await connectivity.checkConnectivityNow();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(probe).not.toHaveBeenCalled();
  });
});
