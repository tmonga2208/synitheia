import { errorLine } from '../api/errorCopy.js';
import { showToast } from './toast.js';

/**
 * A change that can be taken back for a few seconds.
 *
 * `apply` shows it on screen at once; the server only hears about it (`commit`) when the
 * toast goes without Undo being pressed: it timed out, was closed, or a newer toast replaced
 * it. Undo runs `revert` and nothing is ever sent. If sending fails, the change is put back
 * and the toast says why, so the screen never shows a deletion the server did not make.
 *
 * Leaving the screen changes nothing: the toast and these callbacks outlive it.
 */
export interface UndoableChange {
  /** What happened, e.g. "Removed 250 ml". */
  message: string;
  /** What failed, if sending fails, e.g. "Couldn’t remove that entry". */
  failed: string;
  apply: () => void;
  revert: () => void;
  commit: () => Promise<unknown>;
}

export function deferWithUndo(change: UndoableChange): void {
  change.apply();

  showToast({
    message: change.message,
    action: { label: 'Undo', onPress: change.revert },
    onExpire: () => {
      change.commit().catch((error: unknown) => {
        change.revert();
        showToast({ message: errorLine(error, change.failed), tone: 'error' });
      });
    },
  });
}
