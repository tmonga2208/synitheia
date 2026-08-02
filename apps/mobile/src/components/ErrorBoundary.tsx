import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SafeAreaView, Text as RNText, View } from 'react-native';
// Touchable, deliberately, NOT Button: Button (like every other primitive except
// Touchable) calls useTheme() internally, even when every colour it needs is passed in as
// a prop — the hook still runs and still throws outside a provider. Touchable has no
// colour reference of its own, so it is the one shared primitive safe to use here.
import { Touchable } from './primitives.js';
import { radius, spacing, type } from '../theme/tokens.js';
// This is the ONE legitimate exception to "no raw palette outside src/theme/" (enforced by
// lint from Task 9 on). ErrorBoundary renders OUTSIDE <ThemeProvider> by design: if the
// provider itself throws during render, useTheme() would throw again inside this very error
// UI and the original error would be lost. Static light colours, imported directly, are the
// only way this component can render unconditionally. For the same reason it cannot use the
// shared `Text`/`Button` primitives either (see the Touchable comment above) — every element
// below is built from plain React Native components and this file's own static colours.
// eslint-disable-next-line no-restricted-imports -- see comment above; this file is exempt
import { lightPalette } from '../theme/palette.js';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * The last line of defence.
 *
 * A render crash in React Native is a white screen with no way out — the user force-
 * quits and, often, uninstalls. This catches it and offers a way back. It deliberately
 * does NOT show the stack trace: the user cannot act on it, and in an app holding
 * health and financial data, an error message can carry more than it means to.
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

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: lightPalette.bone }}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: spacing.xl,
            gap: spacing.md,
          }}
        >
          <RNText style={[type.title, { color: lightPalette.stone, textAlign: 'center' }]}>
            Something broke
          </RNText>
          <RNText
            style={[
              type.body,
              { color: lightPalette.stoneMuted, textAlign: 'center', maxWidth: 300 },
            ]}
          >
            This isn&apos;t your fault. Your data is safe — nothing was lost.
          </RNText>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Reload"
            onPress={() => this.setState({ error: null })}
            style={{
              marginTop: spacing.lg,
              minHeight: 56,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: spacing.xl,
              backgroundColor: lightPalette.sage,
            }}
          >
            <RNText
              style={[type.cardTitle, { color: lightPalette.white, textAlign: 'center' }]}
            >
              Reload
            </RNText>
          </Touchable>
        </View>
      </SafeAreaView>
    );
  }
}
