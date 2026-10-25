import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WifiOff } from 'lucide-react-native';
import { useIsOnline } from '../api/connectivity.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { radius, spacing } from '../theme/theme.js';
import { Text } from './primitives.js';

/**
 * A small pill under the status bar while the app cannot reach its server.
 *
 * It explains every screen at once: why a list is stale, why a spinner is waiting. It goes
 * away by itself when the connection returns (src/api/connectivity.ts), and never takes a
 * tap, so nothing beneath it is blocked.
 */
export function OfflineBanner() {
  const online = useIsOnline();
  const t = useTheme();
  const insets = useSafeAreaInsets();

  if (online) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + spacing.xs }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.pill, { backgroundColor: t.textPrimary }]}>
        <WifiOff size={14} color={t.bg} strokeWidth={2} />
        <Text variant="caption" color={t.bg}>
          You’re offline. Showing what was last loaded.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
});
