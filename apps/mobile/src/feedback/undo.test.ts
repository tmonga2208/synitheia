import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ToastModule from './toast.js';
import type * as UndoModule from './undo.js';

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-crypto', () => ({
  getRandomBytes: (count: number) => webcrypto.getRandomValues(new Uint8Array(count)),
  randomUUID: () => webcrypto.randomUUID(),
}));

let toast: typeof ToastModule;
let undo: typeof UndoModule;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  toast = await import('./toast.js');
  undo = await import('./undo.js');
});

afterEach(() => {
  vi.useRealTimers();
});

function change(commit: () => Promise<unknown> = async () => undefined) {
  return {
    message: 'Removed 250 ml',
    failed: 'Couldn’t remove that entry',
    apply: vi.fn(),
    revert: vi.fn(),
    commit: vi.fn(commit),
  };
}

describe('deferWithUndo', () => {
  it('shows the change at once and offers to take it back', () => {
    const removal = change();
    undo.deferWithUndo(removal);

    expect(removal.apply).toHaveBeenCalledTimes(1);
    expect(removal.commit).not.toHaveBeenCalled();
    expect(toast.useToast.getState().current).toMatchObject({
      message: 'Removed 250 ml',
      action: { label: 'Undo' },
    });
  });

  it('sends it once nobody took it back', async () => {
    const removal = change();
    undo.deferWithUndo(removal);

    await vi.advanceTimersByTimeAsync(6000);

    expect(removal.commit).toHaveBeenCalledTimes(1);
    expect(removal.revert).not.toHaveBeenCalled();
  });

  it('never sends what was taken back', async () => {
    const removal = change();
    undo.deferWithUndo(removal);

    toast.pressToastAction(toast.useToast.getState().current!.id);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(removal.revert).toHaveBeenCalledTimes(1);
    expect(removal.commit).not.toHaveBeenCalled();
  });

  it('sends the first at once when a second change comes along', () => {
    const first = change();
    const second = change();

    undo.deferWithUndo(first);
    undo.deferWithUndo(second);

    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(second.commit).not.toHaveBeenCalled();
  });

  it('puts it back, and says so, when sending fails', async () => {
    const removal = change(async () => {
      throw new Error('Water entry not found');
    });
    undo.deferWithUndo(removal);

    await vi.advanceTimersByTimeAsync(6000);

    expect(removal.revert).toHaveBeenCalledTimes(1);
    expect(toast.useToast.getState().current).toMatchObject({
      message: 'Couldn’t remove that entry. Water entry not found',
      tone: 'error',
    });
  });
});
