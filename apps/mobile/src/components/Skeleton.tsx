import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { radius, spacing } from '../theme/tokens.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';

/**
 * Skeleton placeholders — the shape of the content, shown while it loads.
 *
 * A spinner says "something is happening"; a skeleton says "here is what is coming". It
 * holds the layout still, so nothing jumps when the data lands, and it reads as calm rather
 * than busy — which is the whole tone of the app.
 *
 * The animation is a slow opacity breath, not a sweeping highlight. A shimmer that races
 * across the screen is the opposite of this product's temperament; a quiet pulse matches it.
 * `useReducedMotion` turns even that off for anyone who has asked the OS for stillness.
 */

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  /** Border radius. Defaults to a soft pill for text-like bars. */
  round?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 14, round, style }: SkeletonProps) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0.6);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 850, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse, reduceMotion]);

  const animated = useAnimatedStyle(() => ({ opacity: reduceMotion ? 0.7 : pulse.value }));

  return (
    <Animated.View
      accessible={false}
      style={[
        {
          width,
          height,
          borderRadius: round ?? radius.sm,
          backgroundColor: t.surfaceRaised,
        },
        animated,
        style,
      ]}
    />
  );
}

/** A circle — for avatars, the completion ring, an icon chip. */
export function SkeletonCircle({ size, style }: { size: number; style?: ViewStyle }) {
  return <Skeleton width={size} height={size} round={size / 2} style={style} />;
}

/**
 * A card-shaped block that mirrors the real cards in a list. Optional leading circle (an
 * icon or avatar) and a couple of text bars, so a list of these reads as a list of rows.
 */
export function SkeletonCard({
  lines = 2,
  showLeading = true,
  style,
}: {
  lines?: number;
  showLeading?: boolean;
  style?: ViewStyle;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.card, style]}>
      {showLeading ? <SkeletonCircle size={40} /> : null}
      <View style={styles.cardBody}>
        <Skeleton width="55%" height={14} />
        {lines > 1 ? <Skeleton width="80%" height={11} /> : null}
        {lines > 2 ? <Skeleton width="40%" height={11} /> : null}
      </View>
    </View>
  );
}

/**
 * The default whole-screen fallback: a title, then a short stack of card rows. Drop-in for
 * the places that used a centred spinner and want no more than "a list is loading".
 */
export function SkeletonList({ rows = 4, showLeading = true }: { rows?: number; showLeading?: boolean }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.screen}>
      <Skeleton width="45%" height={22} style={{ marginBottom: spacing.lg }} />
      <View style={styles.stack}>
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonCard key={i} showLeading={showLeading} />
        ))}
      </View>
    </View>
  );
}

/**
 * A whole-screen skeleton with the top safe-area inset — for the screens that returned a
 * bare centred spinner and just want "this screen is loading" in the right shape.
 */
export function SkeletonScreen({ rows = 4, showLeading = true }: { rows?: number; showLeading?: boolean }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <SafeAreaView style={styles.full} edges={['top']}>
      <SkeletonList rows={rows} showLeading={showLeading} />
    </SafeAreaView>
  );
}

/**
 * The Today screen while it loads: the avatar and greeting, the completion ring, and a
 * couple of habit rows — the same furniture in the same places, so the real day settles in
 * rather than popping in over a spinner.
 */
export function SkeletonToday() {
  const styles = useThemedStyles(makeStyles);

  return (
    <SafeAreaView style={styles.full} edges={['top']}>
      <View style={styles.todayContent}>
        <View style={styles.todayHeader}>
          <SkeletonCircle size={44} />
          <Skeleton width={22} height={22} round={11} />
        </View>

        <Skeleton width="35%" height={12} style={{ marginTop: spacing['2xl'] }} />
        <Skeleton width="70%" height={30} style={{ marginTop: spacing.sm }} />
        <Skeleton width="55%" height={13} style={{ marginTop: spacing.md }} />

        <View style={styles.ringWrap}>
          <SkeletonCircle size={220} />
        </View>

        <Skeleton width="40%" height={18} style={{ marginTop: spacing.xl, marginBottom: spacing.md }} />
        <View style={styles.stack}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    </SafeAreaView>
  );
}

/**
 * The Track screen while it loads: the "Today / Track" heading and the 2×2 tile grid.
 */
export function SkeletonTrackers() {
  const styles = useThemedStyles(makeStyles);

  return (
    <SafeAreaView style={styles.full} edges={['top']}>
      <View style={styles.todayContent}>
        <Skeleton width="20%" height={12} />
        <Skeleton width="40%" height={30} style={{ marginTop: spacing.sm, marginBottom: spacing.xl }} />

        <View style={styles.grid}>
          <Skeleton height={132} round={radius.lg} style={styles.gridItem} />
          <Skeleton height={132} round={radius.lg} style={styles.gridItem} />
          <Skeleton height={132} round={radius.lg} style={styles.gridItem} />
          <Skeleton height={132} round={radius.lg} style={styles.gridItem} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    full: { flex: 1, backgroundColor: t.bg },
    todayContent: { padding: spacing.lg },
    todayHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    ringWrap: { alignItems: 'center', marginTop: spacing['2xl'] },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    gridItem: { flexGrow: 1, flexBasis: '46%' },
    screen: { padding: spacing.lg },
    stack: { gap: spacing.md },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
    },
    cardBody: { flex: 1, gap: spacing.sm },
  });
