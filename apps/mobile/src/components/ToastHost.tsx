import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dismissToast, pressToastAction, useToast } from '../feedback/toast.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { radius, spacing } from '../theme/theme.js';
import { Text, Touchable } from './primitives.js';

/** Clears the tab bar on tab screens; on other screens it simply sits a little higher. */
const ABOVE_TAB_BAR = 72;

/**
 * Shows the current toast (src/feedback/toast.ts) above the bottom of the screen.
 *
 * Inverted colours so it reads as separate from the screen in either theme. Tapping the
 * message closes it; tapping the action (Undo) runs it. Screen readers hear it as it appears.
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

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + ABOVE_TAB_BAR }]}>
      <Animated.View
        key={toast.id}
        entering={FadeInDown.duration(180)}
        exiting={FadeOutDown.duration(150)}
        style={[
          styles.toast,
          { backgroundColor: t.textPrimary },
          toast.tone === 'error' ? { borderLeftWidth: 4, borderLeftColor: t.danger } : null,
        ]}
      >
        <Touchable
          haptic={false}
          onPress={() => dismissToast(toast.id)}
          accessibilityRole="button"
          accessibilityLabel={toast.message}
          accessibilityHint="Closes this message"
          style={styles.message}
        >
          <Text variant="body" color={t.bg}>
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
            <Text variant="bodyMedium" color={t.bg} style={styles.actionLabel}>
              {toast.action.label}
            </Text>
          </Touchable>
        ) : null}
      </Animated.View>
    </View>
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
    width: '100%',
    maxWidth: 520,
    borderRadius: radius.md,
    paddingLeft: spacing.base,
    paddingRight: spacing.xs,
    minHeight: 48,
  },
  message: { flex: 1, paddingVertical: spacing.md },
  action: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { textDecorationLine: 'underline' },
});
