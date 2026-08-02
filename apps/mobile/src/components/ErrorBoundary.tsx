import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SafeAreaView, Text as RNText, View } from 'react-native';
// Touchable, deliberately, NOT Button: Button (like every other primitive except
// Touchable) calls useTheme() internally, even when every colour it needs is passed in as
// a prop — the hook still runs and still throws outside a provider. Touchable has no
// colour reference of its own, so it is the one shared primitive safe to use in EITHER
// fallback below, themed or not.
import { Touchable } from './primitives.js';
import { radius, shadow, spacing, type } from '../theme/tokens.js';
import { useTheme } from '../theme/ThemeProvider.js';
import type { ShadowStyle } from '../theme/theme.js';
// This is the ONE legitimate exception to "no raw palette outside src/theme/" (enforced by
// lint from Task 9 on). It backs ONLY the static fallback below, used by the OUTER boundary
// instance — see the two-boundary note on `Props.themed`.
// eslint-disable-next-line no-restricted-imports -- see comment above; this file is exempt
import { lightPalette } from '../theme/palette.js';

interface Props {
  children: ReactNode;
  /**
   * Two `ErrorBoundary` instances are mounted in `app/_layout.tsx`, at different points in
   * the tree, and this is what tells them apart:
   *
   *   OUTER — `themed` omitted (defaults to `false`). Wraps the ENTIRE app, including
   *   `<ThemeProvider>` itself. This is the only boundary still standing if the provider's
   *   own render throws, and at that point `useTheme()` is unavailable by definition — there
   *   is no live context to read. Its fallback is built entirely from static imports
   *   (`lightPalette`, the static `shadow` export, plain React Native `Text`) and the shared
   *   `Touchable` primitive, which has no colour reference of its own. NOTHING in this
   *   instance's render path may call `useTheme()`, directly or through a primitive that
   *   calls it internally (`Text`/`Button`/`Card`/`Chip`/`Input`/`SectionHeader`/
   *   `EmptyState` all do, even when every colour they need is passed as a prop — the hook
   *   still runs and still throws outside a provider). Do not delete this instance: without
   *   it, a provider-level crash has nothing above it to catch it, and React unmounts to a
   *   blank screen — the exact failure this whole file exists to prevent.
   *
   *   INNER — `themed`. Mounted INSIDE `<ThemeProvider>`, below it in the tree (see
   *   `_layout.tsx`). This is where every OTHER crash lands — which is nearly all of them,
   *   since the provider itself is a few lines of `useMemo` and rarely the thing that
   *   throws. Its fallback reads `useTheme()` and matches the live appearance, so a
   *   dark-mode user who hits a crash anywhere in the app does not get a jarring bone-white
   *   screen at 17:1 against what they were just looking at.
   *
   * Losing this distinction was a real, previously-shipped bug: before this prop existed,
   * there was only ONE `ErrorBoundary`, mounted outermost, and its fallback used the shared
   * `Text`/`Button` primitives. Those primitives call `useTheme()` unconditionally. Since the
   * boundary sat above `<ThemeProvider>`, this was not only wrong for "the provider crashed"
   * — it was wrong for EVERY crash the boundary ever caught: the fallback UI would itself
   * throw from inside `render()`, with nothing left above it, unmounting the app to a blank
   * screen instead of showing the recovery UI. Nothing automated catches that class of bug;
   * it only shows up when something actually crashes. If you are tempted to collapse these
   * two instances back into one "to simplify", re-read this paragraph first.
   */
  themed?: boolean;
}

interface State {
  error: Error | null;
}

/** The colours the fallback needs, resolved once by whichever wrapper is rendering it. */
interface FallbackColors {
  bg: string;
  textPrimary: string;
  textMuted: string;
  buttonBg: string;
  buttonText: string;
  buttonShadow: ShadowStyle;
}

/**
 * The actual fallback UI. Colour-agnostic — every colour arrives as a prop, so this
 * component itself never calls `useTheme()` and is safe for either the static or the
 * themed wrapper below to render.
 */
function ErrorFallback({ colors, onReload }: { colors: FallbackColors; onReload: () => void }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
          gap: spacing.md,
        }}
      >
        <RNText style={[type.title, { color: colors.textPrimary, textAlign: 'center' }]}>
          Something broke
        </RNText>
        <RNText
          style={[
            type.body,
            { color: colors.textMuted, textAlign: 'center', maxWidth: 300 },
          ]}
        >
          This isn&apos;t your fault. Your data is safe — nothing was lost.
        </RNText>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Reload"
          onPress={onReload}
          style={{
            marginTop: spacing.lg,
            minHeight: 56,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
            backgroundColor: colors.buttonBg,
            ...colors.buttonShadow,
          }}
        >
          <RNText style={[type.cardTitle, { color: colors.buttonText, textAlign: 'center' }]}>
            Reload
          </RNText>
        </Touchable>
      </View>
    </SafeAreaView>
  );
}

/** The OUTER boundary's fallback. Static light colours only — no hook, no provider needed. */
function StaticFallback({ onReload }: { onReload: () => void }) {
  return (
    <ErrorFallback
      onReload={onReload}
      colors={{
        bg: lightPalette.bone,
        textPrimary: lightPalette.stone,
        textMuted: lightPalette.stoneMuted,
        buttonBg: lightPalette.sage,
        buttonText: lightPalette.white,
        // The light scale is correct here regardless of the live theme: this fallback only
        // ever renders when there IS no live theme to be correct relative to.
        buttonShadow: shadow.button,
      }}
    />
  );
}

/** The INNER boundary's fallback. Reads the live theme — this is the one place in this file
 *  that calls `useTheme()`, and it is only ever mounted where a provider is guaranteed. */
function ThemedFallback({ onReload }: { onReload: () => void }) {
  const t = useTheme();

  return (
    <ErrorFallback
      onReload={onReload}
      colors={{
        bg: t.bg,
        textPrimary: t.textPrimary,
        textMuted: t.textMuted,
        buttonBg: t.accent,
        buttonText: t.onAccent,
        buttonShadow: t.shadow.button,
      }}
    />
  );
}

/**
 * The last line of defence.
 *
 * A render crash in React Native is a white screen with no way out — the user force-
 * quits and, often, uninstalls. This catches it and offers a way back. It deliberately
 * does NOT show the stack trace: the user cannot act on it, and in an app holding
 * health and financial data, an error message can carry more than it means to.
 *
 * See the doc on `Props.themed` for why TWO instances of this class are mounted in
 * `app/_layout.tsx`, at different points in the tree, and what goes wrong if either is
 * removed or if the themed one is made to render the static fallback (or vice versa).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The hook for Sentry. Until then, at least it reaches the dev console rather
    // than vanishing into a white screen.
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;

    const onReload = () => this.setState({ error: null });

    return this.props.themed ? (
      <ThemedFallback onReload={onReload} />
    ) : (
      <StaticFallback onReload={onReload} />
    );
  }
}
