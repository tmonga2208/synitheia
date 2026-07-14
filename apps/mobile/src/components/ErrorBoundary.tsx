import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SafeAreaView, View } from 'react-native';
import { Button, Text } from './primitives.js';
import { palette, spacing } from '../theme/tokens.js';

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
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.bone }}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: spacing.xl,
            gap: spacing.md,
          }}
        >
          <Text variant="title" center>
            Something broke
          </Text>
          <Text variant="body" color={palette.stoneMuted} center style={{ maxWidth: 300 }}>
            This isn&apos;t your fault. Your data is safe — nothing was lost.
          </Text>
          <Button
            label="Reload"
            onPress={() => this.setState({ error: null })}
            style={{ marginTop: spacing.lg }}
            fullWidth={false}
          />
        </View>
      </SafeAreaView>
    );
  }
}
