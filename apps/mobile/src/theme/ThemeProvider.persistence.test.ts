/**
 * The persisted half of the theme preference: the storage key, what counts as a valid
 * stored value, and what happens when the device storage refuses to answer.
 *
 * The spec requires that "the resolved value survives a reload". `ThemeProvider.test.ts`
 * covers `resolveTheme`, which is pure and knows nothing about storage — so on its own it
 * proves the precedence rules and nothing about the reload. This file is the other half.
 *
 * WHY THIS IS UNIT-TESTABLE AT ALL, given the file it tests is a `.tsx` full of hooks:
 * `usePreferenceStore` is a zustand store, and a zustand store is a plain object with a
 * `.getState()` — the hook form is a convenience for components, not a requirement. So
 * `hydrate()` and `setPreference()` can be called directly, with no renderer and no
 * component-test harness. This repo deliberately has neither, and this file does not
 * introduce one.
 *
 * And `vi.mock` with a FACTORY is what sidesteps the problem that drove the lazy-import
 * design in `ThemeProvider.tsx`: with a factory, Vitest never evaluates the real
 * `@react-native-async-storage/async-storage`, so its web/native environment check — the
 * thing that throws `window is not defined` under Node — never runs. The lazy `await
 * import()` inside the store still resolves to this mock, because `vi.mock` intercepts
 * dynamic imports exactly as it does static ones.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getItem = vi.fn<(key: string) => Promise<string | null>>();
const setItem = vi.fn<(key: string, value: string) => Promise<void>>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));

const { resolveTheme, usePreferenceStore } = await import('./ThemeProvider.js');

/** The key the preference is stored under. Changing it silently orphans every user's choice. */
const STORAGE_KEY = 'synitheia.theme';

beforeEach(async () => {
  // Drain anything still in flight from the previous test BEFORE resetting the spies.
  // `setPreference` is fire-and-forget by design and its write is two microtasks behind
  // the synchronous call (the `await import()`, then the `setItem`), so without this a
  // write from the test before lands after `mockReset()` and shows up as a phantom first
  // call in the next one. That is an artefact of testing a deliberately unawaited effect,
  // not a defect — but it makes assertions order-dependent, which is worse than either.
  await new Promise((resolve) => setTimeout(resolve, 0));

  getItem.mockReset();
  setItem.mockReset();
  getItem.mockResolvedValue(null);
  setItem.mockResolvedValue(undefined);
  // The store is a module singleton, so state leaks between tests unless it is put back.
  usePreferenceStore.setState({ preference: 'system', hydrated: false });
});

describe('hydrate', () => {
  it('starts at system, unhydrated', () => {
    expect(usePreferenceStore.getState().preference).toBe('system');
    expect(usePreferenceStore.getState().hydrated).toBe(false);
  });

  it('reads the preference from the documented storage key', async () => {
    getItem.mockResolvedValue('dark');
    await usePreferenceStore.getState().hydrate();

    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(usePreferenceStore.getState().preference).toBe('dark');
  });

  it.each(['light', 'dark', 'system'] as const)('restores a stored %s', async (stored) => {
    getItem.mockResolvedValue(stored);
    await usePreferenceStore.getState().hydrate();
    expect(usePreferenceStore.getState().preference).toBe(stored);
  });

  it('opens the hydration gate', async () => {
    await usePreferenceStore.getState().hydrate();
    expect(usePreferenceStore.getState().hydrated).toBe(true);
  });

  it('keeps system when nothing has been stored yet', async () => {
    getItem.mockResolvedValue(null);
    await usePreferenceStore.getState().hydrate();
    expect(usePreferenceStore.getState().preference).toBe('system');
  });

  it.each(['DARK', 'Light', 'blue', '', 'true', '{"preference":"dark"}'])(
    'ignores the invalid stored value %j rather than trusting it',
    async (stored) => {
      // Device storage is not a trusted input: it survives app upgrades, and a value
      // written by an older or newer build can be anything at all. Anything that is not
      // one of the three literals must leave the default standing, not be cast to it —
      // `preference` is typed `'light' | 'dark' | 'system'` and the rest of the file,
      // including `Appearance.setColorScheme()`, relies on that being true at runtime.
      getItem.mockResolvedValue(stored);
      await usePreferenceStore.getState().hydrate();

      expect(usePreferenceStore.getState().preference).toBe('system');
      // ...and it still lets the app start.
      expect(usePreferenceStore.getState().hydrated).toBe(true);
    },
  );

  it('still opens the gate when the read rejects', async () => {
    // The path the `finally` exists for, and the one that matters most: `_layout.tsx`
    // returns `null` and HOLDS THE SPLASH until `hydrated` is true. If a failed read left
    // the gate shut, the app would never render at all — a storage error would become a
    // permanent splash screen rather than a preference that fell back to 'system'.
    getItem.mockRejectedValue(new Error('storage unavailable'));

    await expect(usePreferenceStore.getState().hydrate()).resolves.toBeUndefined();

    expect(usePreferenceStore.getState().hydrated).toBe(true);
    expect(usePreferenceStore.getState().preference).toBe('system');
  });

  it('does not reject, so callers can fire it without handling', async () => {
    // `useThemeHydrated` calls this as `void hydrate()`. A rejection there is an
    // unhandled promise rejection on the exact failure path the design handles
    // deliberately, so swallowing has to happen inside `hydrate`, not at the call site.
    getItem.mockRejectedValue(new Error('storage unavailable'));
    await expect(usePreferenceStore.getState().hydrate()).resolves.not.toThrow();
  });

  it('is idempotent — a second call is harmless', async () => {
    getItem.mockResolvedValue('dark');
    await usePreferenceStore.getState().hydrate();
    await usePreferenceStore.getState().hydrate();
    expect(usePreferenceStore.getState().preference).toBe('dark');
    expect(usePreferenceStore.getState().hydrated).toBe(true);
  });
});

describe('setPreference', () => {
  it('applies the choice to memory immediately', () => {
    usePreferenceStore.getState().setPreference('dark');
    // Synchronous on purpose: the theme must flip on the very next render, not once a
    // device write has come back.
    expect(usePreferenceStore.getState().preference).toBe('dark');
  });

  it('persists the choice under the documented key', async () => {
    usePreferenceStore.getState().setPreference('light');
    await vi.waitFor(() => expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, 'light'));
  });

  it('persists system as a real stored value, not as an erasure', async () => {
    // 'system' has to be written, not removed. A user who deliberately goes back to System
    // after choosing Dark is expressing a preference; leaving the old 'dark' in storage
    // would resurrect it on the next cold start.
    usePreferenceStore.getState().setPreference('dark');
    await vi.waitFor(() => expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, 'dark'));

    usePreferenceStore.getState().setPreference('system');
    await vi.waitFor(() => expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, 'system'));
  });

  it('keeps the in-memory choice when the write fails, and does not reject', async () => {
    // Fire-and-forget by design — see the comment on `setPreference`. The cost of a failed
    // write is that the next cold start reverts to 'system'; the cost of an UNHANDLED
    // rejection is a redbox in dev on a path the design already decided to tolerate.
    setItem.mockRejectedValue(new Error('disk full'));

    expect(() => usePreferenceStore.getState().setPreference('dark')).not.toThrow();
    expect(usePreferenceStore.getState().preference).toBe('dark');

    await vi.waitFor(() => expect(setItem).toHaveBeenCalled());
    // Give the rejection a turn to surface as unhandled if it is going to.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(usePreferenceStore.getState().preference).toBe('dark');
  });
});

describe('the resolved value survives a reload', () => {
  // The spec's actual wording, tested end to end: write a preference, throw the store away
  // as a cold start would, hydrate from what was persisted, and check the SAME theme
  // resolves. This is the assertion the spec asked for and the one nothing covered.
  it.each([
    { chose: 'dark', osSays: 'light' },
    { chose: 'light', osSays: 'dark' },
  ] as const)('a user who chose $chose gets $chose back on a light/dark flip', async ({ chose, osSays }) => {
    // ── session one ──
    usePreferenceStore.getState().setPreference(chose);
    await vi.waitFor(() => expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, chose));
    const written = setItem.mock.calls.at(-1)?.[1] as string;

    // ── the reload: memory is gone, only what reached storage remains ──
    usePreferenceStore.setState({ preference: 'system', hydrated: false });
    getItem.mockResolvedValue(written);

    // ── session two ──
    await usePreferenceStore.getState().hydrate();

    expect(usePreferenceStore.getState().preference).toBe(chose);
    // ...and it still beats the OS, which is the whole point of having overridden it.
    expect(resolveTheme(usePreferenceStore.getState().preference, osSays)).toBe(chose);
  });

  it('a system user keeps following the OS across a reload', async () => {
    usePreferenceStore.getState().setPreference('system');
    await vi.waitFor(() => expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, 'system'));

    usePreferenceStore.setState({ preference: 'system', hydrated: false });
    getItem.mockResolvedValue('system');
    await usePreferenceStore.getState().hydrate();

    const { preference } = usePreferenceStore.getState();
    expect(resolveTheme(preference, 'dark')).toBe('dark');
    expect(resolveTheme(preference, 'light')).toBe('light');
  });
});
