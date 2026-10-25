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

function deferred() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('coming back online with changes to send', () => {
  let gate: ReturnType<typeof deferred>;
  const beforeOnline = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    stop();
    gate = deferred();
    beforeOnline.mockReset().mockImplementation(() => gate.promise);
    stop = connectivity.startConnectivity(probe, { beforeOnline });
  });

  it('sends what waited first, and only then lets queries run', async () => {
    connectivity.noteNetworkFailure();
    connectivity.noteNetworkSuccess();

    expect(beforeOnline).toHaveBeenCalledTimes(1);
    expect(onlineManager.isOnline()).toBe(false);

    gate.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('is neither hurried nor repeated by answers that arrive meanwhile', async () => {
    connectivity.noteNetworkFailure();
    connectivity.noteNetworkSuccess();
    connectivity.noteNetworkSuccess();
    await connectivity.checkConnectivityNow();
    connectivity.noteNetworkSuccess();

    expect(onlineManager.isOnline()).toBe(false);
    expect(beforeOnline).toHaveBeenCalledTimes(1);

    gate.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('stays offline, and keeps checking, when the connection drops again meanwhile', async () => {
    connectivity.noteNetworkFailure();
    connectivity.noteNetworkSuccess();
    connectivity.noteNetworkFailure();

    gate.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(beforeOnline).toHaveBeenCalledTimes(1);
    expect(onlineManager.isOnline()).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('lets queries run even when sending what waited fails', async () => {
    beforeOnline.mockRejectedValueOnce(new Error('boom'));

    connectivity.noteNetworkFailure();
    connectivity.noteNetworkSuccess();
    await vi.advanceTimersByTimeAsync(0);

    expect(beforeOnline).toHaveBeenCalledTimes(1);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('finishes a check only once it is back online', async () => {
    connectivity.noteNetworkFailure();
    probe.mockResolvedValue(true);

    const checked = connectivity.checkConnectivityNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(onlineManager.isOnline()).toBe(false);

    gate.release();
    await checked;
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('at launch, holds queries until changes left from last time are sent', async () => {
    const held = connectivity.holdUntilSynced();

    expect(onlineManager.isOnline()).toBe(false);
    expect(beforeOnline).toHaveBeenCalledTimes(1);

    gate.release();
    await held;
    expect(onlineManager.isOnline()).toBe(true);
  });
});
