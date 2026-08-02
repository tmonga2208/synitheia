/**
 * The theme runtime: which `Theme` is live, whether that follows the OS or a manual
 * override, and getting the answer painted on the very first frame.
 *
 * A note on how `react-native` is imported here. Its published package ships Flow-typed
 * source for Metro to transform at bundle time — Vitest (Vite/esbuild/rollup) cannot parse
 * it at all, and neither can plain Node. That is fine for the app, which only ever runs
 * through Metro, but it means a static `import { useColorScheme } from 'react-native'` at
 * the top of this file would make `ThemeProvider.test.ts` blow up the moment it imports
 * `resolveTheme` — ES modules execute every top-level import in a file whether or not the
 * importer uses it. So the one value-level touch of `react-native` in this file
 * (`useSystemColorScheme`, below) requires it lazily, INSIDE the hook body, where it only
 * runs when a component actually renders — which never happens in the unit test. Metro
 * treats a `require()` inside a function exactly like a top-level import; only *when* the
 * module is first evaluated changes, not whether it works on-device. Type-only imports
 * (`import type … from 'react-native'`) are erased before this problem could ever apply,
 * which is why `ColorSchemeName` below is imported normally.
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type * as ReactNative from 'react-native';
import type { ColorSchemeName } from 'react-native';
import { create } from 'zustand';
import { darkTheme, lightTheme, type Theme, type ThemeName } from './theme.js';

const STORAGE_KEY = 'synitheia.theme';

export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * The pure decision at the heart of this file: given what the user asked for and what the
 * OS currently reports, which theme is live?
 *
 * Everything else here — the store, AsyncStorage, `useColorScheme` — exists only to feed
 * this function its two arguments, which is why it is exported and tested on its own
 * rather than through a rendered component (this repo has no component-test harness).
 */
export function resolveTheme(preference: ThemePreference, systemScheme: ColorSchemeName): ThemeName {
  if (preference !== 'system') return preference;

  // `useColorScheme()` returns null before the OS answers, and on some Android builds.
  // Defaulting to dark there would flash a dark screen at a light-mode user, so an unknown
  // system reads as light — the same choice the pre-dark-mode app always made.
  return systemScheme ?? 'light';
}

interface PreferenceState {
  preference: ThemePreference;
  /** Has the AsyncStorage read completed? See the hydration note on `ThemeProvider` below. */
  hydrated: boolean;
  setPreference: (preference: ThemePreference) => void;
  hydrate: () => Promise<void>;
}

/**
 * Holds the user's choice — 'system' by default — persisted under `synitheia.theme`.
 *
 * Deliberately `AsyncStorage`, not `expo-secure-store`: this is a display preference, not a
 * credential, and there is nothing here for the Keychain to protect.
 */
const usePreferenceStore = create<PreferenceState>((set) => ({
  preference: 'system',
  hydrated: false,

  setPreference(preference) {
    set({ preference });
    // Fire-and-forget. A write that fails leaves the in-memory choice correct for the rest
    // of this session; the only cost is that the next cold start reverts to 'system',
    // which is an acceptable degradation for a display preference.
    void (async () => {
      const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.setItem(STORAGE_KEY, preference);
    })();
  },

  async hydrate() {
    try {
      const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        set({ preference: stored });
      }
    } finally {
      set({ hydrated: true });
    }
  },
}));

/**
 * Triggers the AsyncStorage read on first use (idempotent — `hydrate()` may end up called
 * more than once if this is used in more than one place, which is harmless) and reports
 * whether it has completed.
 *
 * This does its work in a `useEffect`, deliberately NOT as a module-scope side effect run
 * at import time. Two reasons: it mirrors `useAuth`'s `hydrate()`, which is likewise only
 * ever triggered from a mounted component's effect (see `AuthGate` in `_layout.tsx`); and,
 * concretely, a module-scope call was tried here first and broke `ThemeProvider.test.ts` —
 * merely importing `resolveTheme` was enough to run it, which reached into
 * `@react-native-async-storage/async-storage`'s web/native environment check and crashed
 * under Vitest's Node environment (`window is not defined`). An effect only runs when a
 * component actually mounts, which the unit test never does.
 *
 * `_layout.tsx` calls this directly, ahead of `<ThemeProvider>`, so the read starts at the
 * same time font loading does rather than only once `<ThemeProvider>` itself has mounted —
 * which would be one render too late, since that only happens after the layout's existing
 * font gate has already opened.
 */
export function useThemeHydrated(): boolean {
  const hydrated = usePreferenceStore((s) => s.hydrated);
  const hydrate = usePreferenceStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return hydrated;
}

/** The current preference and a setter, decoupled from which `Theme` object that resolves to. */
export function useThemePreference(): {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  resolved: ThemeName;
} {
  const preference = usePreferenceStore((s) => s.preference);
  const setPreference = usePreferenceStore((s) => s.setPreference);
  const systemScheme = useSystemColorScheme();

  return { preference, setPreference, resolved: resolveTheme(preference, systemScheme) };
}

/** See the file-header note: required lazily so importing this module never loads `react-native`. */
function useSystemColorScheme(): ColorSchemeName {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see file header
  const { useColorScheme } = require('react-native') as typeof ReactNative;
  return useColorScheme();
}

const ThemeContext = createContext<Theme | undefined>(undefined);

/**
 * Wraps the app and supplies the live `Theme` through context.
 *
 * Hydration must not flash: until AsyncStorage answers, we do not yet know about a stored
 * override, and rendering a default theme and then switching would be a visible flip on
 * every cold start — worst case for exactly the user this feature is for, someone who
 * overrode the OS on purpose. `_layout.tsx` already gated its first render on font loading
 * (`if (!fontsLoaded && !fontError) return null`); its `RootLayout` now also calls
 * `useThemeHydrated()` and folds it into that same gate, so `<ThemeProvider>` (this
 * component) never mounts — never runs even once — until the preference is known. By the
 * time this component's first render happens, `preference` already reflects any stored
 * override, and `resolveTheme` runs once against the right inputs — there is no
 * default-then-switch step for this component to get wrong.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = usePreferenceStore((s) => s.preference);
  const systemScheme = useSystemColorScheme();

  const theme = useMemo(() => {
    const resolved = resolveTheme(preference, systemScheme);
    return resolved === 'dark' ? darkTheme : lightTheme;
  }, [preference, systemScheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** The live `Theme`. Throws outside `<ThemeProvider>` — a silent `undefined` would surface as a blank screen. */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme() must be called within <ThemeProvider>.');
  return theme;
}
