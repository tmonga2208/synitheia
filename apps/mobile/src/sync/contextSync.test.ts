import { describe, expect, it, vi } from 'vitest';
import { runContextSync, type ContextSyncDeps } from './contextSync.js';

const suggestion = {
  id: '6a7025c8d36b5e0013390202',
  type: 'possible_habit_completion' as const,
  title: 'Mark Run done?',
  actionable: true,
};

function deps(overrides: Partial<ContextSyncDeps> = {}): ContextSyncDeps {
  return {
    readSourcePrefs: vi.fn(async () => ({ health: true, calendar: true, background: true })),
    hasSession: vi.fn(async () => true),
    runHealthSync: vi.fn(async () => ({ ok: true, skipped: false, suggestions: [] })),
    runCalendarSync: vi.fn(async () => ({ ok: true, skipped: false, suggestions: [] })),
    notifySuggestions: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('runContextSync', () => {
  it('runs every connected source in background mode and notifies what came back', async () => {
    const d = deps({
      runHealthSync: vi.fn(async () => ({ ok: true, skipped: false, suggestions: [suggestion] })),
    });

    expect(await runContextSync(d)).toBe('ok');

    expect(d.runHealthSync).toHaveBeenCalledWith({ background: true });
    expect(d.runCalendarSync).toHaveBeenCalledWith({ background: true });
    expect(d.notifySuggestions).toHaveBeenCalledWith([suggestion]);
  });

  it('does nothing when the user switched background sync off', async () => {
    const d = deps({
      readSourcePrefs: vi.fn(async () => ({ health: true, calendar: true, background: false })),
    });
    expect(await runContextSync(d)).toBe('skipped');
    expect(d.runHealthSync).not.toHaveBeenCalled();
    expect(d.runCalendarSync).not.toHaveBeenCalled();
  });

  it('does nothing when signed out', async () => {
    const d = deps({ hasSession: vi.fn(async () => false) });
    expect(await runContextSync(d)).toBe('skipped');
    expect(d.runHealthSync).not.toHaveBeenCalled();
  });

  it('skips, rather than fails, when the keychain cannot be read', async () => {
    // A locked phone whose tokens are not yet background-readable. Reporting failure
    // would teach the OS to wake the app less often for something a later run can do.
    const d = deps({
      hasSession: vi.fn(async () => {
        throw new Error('errSecInteractionNotAllowed');
      }),
    });
    expect(await runContextSync(d)).toBe('skipped');
    expect(d.runHealthSync).not.toHaveBeenCalled();
  });

  it('does not read a source the user has switched off', async () => {
    const d = deps({
      readSourcePrefs: vi.fn(async () => ({ health: false, calendar: true, background: true })),
    });
    expect(await runContextSync(d)).toBe('ok');
    expect(d.runHealthSync).not.toHaveBeenCalled();
    expect(d.runCalendarSync).toHaveBeenCalledTimes(1);
  });

  it('is still ok when one source fails and the other works', async () => {
    const d = deps({
      runHealthSync: vi.fn(async () => ({ ok: false, skipped: false, suggestions: [] })),
    });
    expect(await runContextSync(d)).toBe('ok');
  });

  it('is ok when health had nothing to send — a locked phone is not a failure', async () => {
    const d = deps({
      readSourcePrefs: vi.fn(async () => ({ health: true, calendar: false, background: true })),
      runHealthSync: vi.fn(async () => ({ ok: true, skipped: true, suggestions: [] })),
    });
    expect(await runContextSync(d)).toBe('ok');
  });

  it('fails only when everything it attempted failed', async () => {
    const d = deps({
      runHealthSync: vi.fn(async () => ({ ok: false, skipped: false, suggestions: [] })),
      runCalendarSync: vi.fn(async () => ({ ok: false, skipped: false, suggestions: [] })),
    });
    expect(await runContextSync(d)).toBe('failed');
    expect(d.notifySuggestions).not.toHaveBeenCalled();
  });

  it('does not call the notifier with an empty list', async () => {
    const d = deps();
    await runContextSync(d);
    expect(d.notifySuggestions).not.toHaveBeenCalled();
  });
});
