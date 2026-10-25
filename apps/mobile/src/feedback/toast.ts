import { create } from 'zustand';

/**
 * One short message at the bottom of the screen: what just happened, and sometimes a way to
 * take it back.
 *
 * Every failed action reports through here (app/_layout.tsx), as does every undo
 * (undo.ts), so the app has one way of saying "that didn't work" and one of "done, undo?".
 * One toast at a time: a new one replaces the old, and the old one's `onExpire` runs as if
 * it had timed out, so an undo that was still pending commits rather than being lost.
 */

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface Toast {
  id: string;
  message: string;
  tone: 'neutral' | 'error';
  action?: ToastAction;
  durationMs: number;
}

export interface ShowToastInput {
  message: string;
  tone?: 'neutral' | 'error';
  action?: ToastAction;
  /** Runs when the toast goes without its action being pressed. */
  onExpire?: () => void;
  durationMs?: number;
}

const PLAIN_MS = 4000;
/** Long enough to find and press Undo. */
const WITH_ACTION_MS = 6000;

export const useToast = create<{ current: Toast | null }>(() => ({ current: null }));

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingExpire: (() => void) | null = null;
let counter = 0;

/** Take the current toast down. Its onExpire runs unless its action was taken. */
function end(id: string, actionTaken: boolean): Toast | null {
  const current = useToast.getState().current;
  if (current?.id !== id) return null;

  if (timer) clearTimeout(timer);
  timer = null;
  const expire = pendingExpire;
  pendingExpire = null;
  useToast.setState({ current: null });

  if (!actionTaken) expire?.();
  return current;
}

export function showToast(input: ShowToastInput): string {
  const previous = useToast.getState().current;
  if (previous) end(previous.id, false);

  counter += 1;
  const toast: Toast = {
    id: `toast-${counter}`,
    message: input.message,
    tone: input.tone ?? 'neutral',
    action: input.action,
    durationMs: input.durationMs ?? (input.action ? WITH_ACTION_MS : PLAIN_MS),
  };

  pendingExpire = input.onExpire ?? null;
  useToast.setState({ current: toast });
  timer = setTimeout(() => end(toast.id, false), toast.durationMs);
  return toast.id;
}

/** The toast's action was pressed: run it, and do not finish what it was waiting on. */
export function pressToastAction(id: string): void {
  const toast = end(id, true);
  toast?.action?.onPress();
}

/** Closed by hand: the same as letting it expire. */
export function dismissToast(id: string): void {
  end(id, false);
}
