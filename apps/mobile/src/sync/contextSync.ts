import type { SyncSuggestion } from '@synitheia/shared';
import type { SyncRunResult } from './runHealthSync.js';
import type { SourcePrefs } from './sourcePrefs.js';

export interface ContextSyncDeps {
  readSourcePrefs: () => Promise<SourcePrefs>;
  hasSession: () => Promise<boolean>;
  runHealthSync: (options: { background: boolean }) => Promise<SyncRunResult>;
  runCalendarSync: (options: { background: boolean }) => Promise<SyncRunResult>;
  notifySuggestions: (suggestions: readonly SyncSuggestion[]) => Promise<void>;
}

async function defaultDeps(): Promise<ContextSyncDeps> {
  const [prefs, client, health, calendar, notify] = await Promise.all([
    import('./sourcePrefs.js'),
    import('../api/client.js'),
    import('./runHealthSync.js'),
    import('./runCalendarSync.js'),
    import('./notifySuggestions.js'),
  ]);
  return {
    readSourcePrefs: prefs.readSourcePrefs,
    hasSession: client.hasSession,
    runHealthSync: health.runHealthSync,
    runCalendarSync: calendar.runCalendarSync,
    notifySuggestions: notify.notifySuggestions,
  };
}

/**
 * The body of the background task: sync whatever is connected, then say so if it matters.
 *
 * Sources run one after the other, not in parallel. The OS gives a background task a
 * short, unspecified budget; two overlapping network calls that are both cut off are
 * worth less than one that finished.
 *
 * `'failed'` is reported only when every attempt failed. The OS backs off a task that
 * reports failure, and a locked phone that could sync its calendar but not Health has
 * not failed.
 */
export async function runContextSync(
  injected?: ContextSyncDeps,
): Promise<'skipped' | 'ok' | 'failed'> {
  const deps = injected ?? (await defaultDeps());

  const prefs = await deps.readSourcePrefs();
  if (!prefs.background || (!prefs.health && !prefs.calendar)) return 'skipped';
  if (!(await deps.hasSession())) return 'skipped';

  const results: SyncRunResult[] = [];
  if (prefs.health) results.push(await deps.runHealthSync({ background: true }));
  if (prefs.calendar) results.push(await deps.runCalendarSync({ background: true }));

  if (results.every((r) => !r.ok)) return 'failed';

  const suggestions = results.flatMap((r) => r.suggestions);
  if (suggestions.length > 0) await deps.notifySuggestions(suggestions);

  return 'ok';
}
