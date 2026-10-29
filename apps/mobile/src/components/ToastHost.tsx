import { useEffect, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Check } from 'lucide-react-native';
import { dismissToast, pressToastAction, useToast } from '../feedback/toast.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { radius, spacing } from '../theme/theme.js';
import { Text, Touchable } from './primitives.js';

/** Clears the tab bar on tab screens; on other screens it simply sits a little higher. */
const ABOVE_TAB_BAR = 72;

/**
 * On iOS a screen opened as a sheet sits in its own native window, above the app's root
 * view, so a toast drawn in the root view was hidden behind it: delete a glass on Water
 * and the Undo never appeared. FullWindowOverlay draws above every window. Android has
 * one window, so the plain view already sits on top.
 */
function AboveEverything({ children }: { children: ReactNode }) {
  return Platform.OS === 'ios' ? <FullWindowOverlay>{children}</FullWindowOverlay> : <>{children}</>;
}

/**
 * Shows the current toast (src/feedback/toast.ts) above the bottom of the screen: a raised
 * card in the app's own colours, with a small mark for what happened and the action in the
 * accent. Tapping the message closes it; tapping the action (Undo) runs it. Screen readers
 * hear it as it appears.
 */
export function ToastHost() {
  const toast = useToast((state) => state.current);
  const t = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toast) return;
    AccessibilityInfo.announceForAccessibility(
      toast.action ? `${toast.message} ${toast.action.label} is available.` : toast.message,
    );
  }, [toast]);

  if (!toast) return null;
  const error = toast.tone === 'error';

  return (
    <AboveEverything>
      <View
        pointerEvents="box-none"
        style={[styles.wrap, { bottom: insets.bottom + ABOVE_TAB_BAR }]}
      >
        <Animated.View
          key={toast.id}
          entering={FadeInDown.duration(220)}
          exiting={FadeOutDown.duration(160)}
          style={[
            styles.toast,
            { backgroundColor: t.surfaceRaised, borderColor: t.border },
            t.shadow.raised,
          ]}
        >
          <View
            style={[styles.mark, { backgroundColor: error ? `${t.danger}2E` : t.accentWash }]}
          >
            {error ? (
              <AlertCircle size={15} color={t.danger} strokeWidth={2.2} />
            ) : (
              <Check size={15} color={t.accent} strokeWidth={2.6} />
            )}
          </View>

          <Touchable
            haptic={false}
            onPress={() => dismissToast(toast.id)}
            accessibilityRole="button"
            accessibilityLabel={toast.message}
            accessibilityHint="Closes this message"
            style={styles.message}
          >
            <Text variant="body" color={t.textPrimary} numberOfLines={2}>
              {toast.message}
            </Text>
          </Touchable>

          {toast.action ? (
            <Touchable
              haptic={false}
              onPress={() => pressToastAction(toast.id)}
              accessibilityRole="button"
              accessibilityLabel={toast.action.label}
              style={styles.action}
            >
              <Text variant="bodyMedium" color={error ? t.danger : t.accent}>
                {toast.action.label}
              </Text>
            </Touchable>
          ) : null}
        </Animated.View>
      </View>
    </AboveEverything>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.base,
    right: spacing.base,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    maxWidth: 520,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    minHeight: 52,
  },
  mark: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { flexShrink: 1, paddingVertical: spacing.md },
  action: {
    minHeight: 44,
    minWidth: 56,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
