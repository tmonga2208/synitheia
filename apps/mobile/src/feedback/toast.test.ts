import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ToastModule from './toast.js';

let toast: typeof ToastModule;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  toast = await import('./toast.js');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toasts', () => {
  it('shows one at a time, and goes away by itself', async () => {
    toast.showToast({ message: 'Saved' });
    expect(toast.useToast.getState().current?.message).toBe('Saved');

    await vi.advanceTimersByTimeAsync(4000);
    expect(toast.useToast.getState().current).toBeNull();
  });

  it('stays longer when it offers an action', async () => {
    toast.showToast({ message: 'Removed 250 ml', action: { label: 'Undo', onPress: () => undefined } });

    await vi.advanceTimersByTimeAsync(4000);
    expect(toast.useToast.getState().current).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(toast.useToast.getState().current).toBeNull();
  });

  it('finishes what it was waiting on when it expires, once', async () => {
    const onExpire = vi.fn();
    toast.showToast({ message: 'Removed 250 ml', onExpire });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('finishes what the old one was waiting on when a new one replaces it', () => {
    const first = vi.fn();
    toast.showToast({ message: 'Removed 250 ml', onExpire: first });
    toast.showToast({ message: 'Removed 300 ml' });

    expect(first).toHaveBeenCalledTimes(1);
    expect(toast.useToast.getState().current?.message).toBe('Removed 300 ml');
  });

  it('runs the action instead of finishing when the action is pressed', async () => {
    const onExpire = vi.fn();
    const undo = vi.fn();
    const id = toast.showToast({
      message: 'Removed 250 ml',
      action: { label: 'Undo', onPress: undo },
      onExpire,
    });

    toast.pressToastAction(id);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(undo).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
    expect(toast.useToast.getState().current).toBeNull();
  });

  it('treats closing it like letting it expire', () => {
    const onExpire = vi.fn();
    const id = toast.showToast({ message: 'Removed 250 ml', onExpire });

    toast.dismissToast(id);

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(toast.useToast.getState().current).toBeNull();
  });

  it('ignores a press meant for a toast that is already gone', () => {
    const undo = vi.fn();
    const id = toast.showToast({ message: 'Removed', action: { label: 'Undo', onPress: undo } });
    toast.showToast({ message: 'Something else' });

    toast.pressToastAction(id);

    expect(undo).not.toHaveBeenCalled();
    expect(toast.useToast.getState().current?.message).toBe('Something else');
  });
});
