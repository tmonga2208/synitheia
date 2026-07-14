import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ChevronRight } from 'lucide-react-native';
import { Text, Touchable } from './primitives.js';
import { motion, palette, radius, shadow, spacing } from '../theme/tokens.js';

/**
 * One domain, at a glance.
 *
 * The Trackers screen previously gave each domain a full-width card carrying both its
 * summary AND its controls, which stacked into four mini-dashboards — the cluttered
 * productivity dashboard the product explicitly isn't. A tile answers one question
 * ("where am I on this?") and nothing else; acting is a separate, deliberate motion.
 *
 * No ring here, deliberately. Four small rings would compete with the one big ring on
 * Today, which is the app's emotional centre and should stay unique. A hairline rail is
 * quieter and reads faster at this size.
 */
export interface TrackerTileProps {
  label: string;
  icon: React.ReactNode;
  /** The number that matters. "800 ml", "₹1,240", "2 of 3". */
  value: string;
  /** What the number is measured against. "of 2,500 ml", "3 today". */
  caption: string;
  accent: { base: string; wash: string; text: string };
  /**
   * 0–1, or null when this domain has no target.
   *
   * Null is not zero. Expenses with no budget set has nothing to be a fraction of, and
   * drawing an empty rail would invent a goal the user never chose — the same reason
   * the Daily Flow ring only counts trackers you actually use.
   */
  progress: number | null;
  onPress: () => void;
}

export function TrackerTile({
  label,
  icon,
  value,
  caption,
  accent,
  progress,
  onPress,
}: TrackerTileProps) {
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = withTiming(progress ?? 0, {
      duration: motion.ring.duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, fill]);

  const railStyle = useAnimatedStyle(() => ({
    width: `${Math.min(100, Math.max(0, fill.value * 100))}%`,
  }));

  return (
    <Touchable
      style={styles.tile}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${value} ${caption}.`}
    >
      <View style={styles.header}>
        <View style={[styles.iconChip, { backgroundColor: accent.wash }]}>{icon}</View>
        <ChevronRight size={18} color={palette.stoneFaint} strokeWidth={1.8} />
      </View>

      <Text variant="overline" color={accent.text} style={styles.label}>
        {label}
      </Text>

      <Text variant="heading" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="caption" color={palette.stoneMuted} numberOfLines={1}>
        {caption}
      </Text>

      {/* No target, no rail. An empty rail would be a goal the user never set. */}
      {progress !== null ? (
        <View style={styles.railTrack}>
          <Animated.View
            style={[styles.railFill, railStyle, { backgroundColor: accent.base }]}
          />
        </View>
      ) : (
        <View style={styles.railSpacer} />
      )}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 158,
    backgroundColor: palette.bone,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.surfaceDim,
    padding: spacing.base,
    justifyContent: 'flex-start',
    ...shadow.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { marginTop: spacing.md, marginBottom: spacing.xs },
  railTrack: {
    height: 3,
    borderRadius: radius.full,
    backgroundColor: palette.surfaceDim,
    marginTop: 'auto',
    overflow: 'hidden',
  },
  // Keeps the four tiles the same height whether or not they have a target.
  railSpacer: { height: 3, marginTop: 'auto' },
  railFill: { height: 3, borderRadius: radius.full },
});
