import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { hasSession } from '../api/client.js';
import { refreshReminders } from '../reminders/schedule.js';
import { runContextSync } from './contextSync.js';
import { shouldRegister } from './registration.js';
import { readSourcePrefs } from './sourcePrefs.js';

export const CONTEXT_SYNC_TASK = 'synitheia.context-sync';

/** Minutes. A request, not a schedule: the OS runs it when battery and usage allow. */
const MINIMUM_INTERVAL = 30;

/**
 * Defined at module scope, and this module is imported from the root layout, because a
 * background launch starts the JS runtime without rendering any screen. A task defined
 * inside a component would not exist when the OS came looking for it.
 *
 * Best-effort by nature. iOS will not run it after a force-quit, defers it in Low Power
 * Mode, and never runs it in the Simulator.
 */
TaskManager.defineTask(CONTEXT_SYNC_TASK, async () => {
  try {
    const outcome = await runContextSync();
    // Synced steps can complete a habit, and the two-week plan needs topping up anyway.
    // A reminder failure must not fail the sync; refreshReminders never throws.
    await refreshReminders({ background: true });
    return outcome === 'failed'
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Make the task's registration match what the user has set up. The one place that
 * registers or unregisters. Safe to call repeatedly and never throws — it is called from
 * effects that have no useful way to handle a failure.
 */
export async function syncBackgroundRegistration(): Promise<void> {
  try {
    const [prefs, signedIn, registered] = await Promise.all([
      readSourcePrefs(),
      hasSession(),
      TaskManager.isTaskRegisteredAsync(CONTEXT_SYNC_TASK),
    ]);

    const wanted = shouldRegister({ signedIn, prefs });

    if (wanted && !registered) {
      await BackgroundTask.registerTaskAsync(CONTEXT_SYNC_TASK, {
        minimumInterval: MINIMUM_INTERVAL,
      });
    } else if (!wanted && registered) {
      await BackgroundTask.unregisterTaskAsync(CONTEXT_SYNC_TASK);
    }
  } catch {
    // Background tasks can be unavailable (restricted by the OS, or the Simulator). The
    // app works without them; foreground sync is unaffected.
  }
}
