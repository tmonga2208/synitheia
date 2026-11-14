import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, Plus } from 'lucide-react-native';
import { goBackOrHome } from '../navigation/goBackOrHome.js';
import { MIN_TAP_TARGET, radius, spacing } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';
import { Text, Touchable } from './primitives.js';

interface ScreenHeaderProps {
  /** The small capitals over the title: "TODAY", "RECURRING". */
  overline?: string;
  /** A tracker's screen puts its own colour here; everywhere else it is the quiet grey. */
  overlineColor?: string;
  title?: string;
  /** A sentence or two under the title. */
  subtitle?: string;
  /** A control at the top right, level with the back arrow. Usually a `HeaderAdd`. */
  action?: ReactNode;
  /** Where the arrow goes. Left out, it goes back, or to Today when there is no back. */
  onBack?: () => void;
  backLabel?: string;
  /**
   * The space under the header, when it is not the usual one. For a screen whose first
   * block already carries a top margin of its own, so the two do not add up.
   */
  gapBelow?: number;
}

/**
 * The top of every screen that is opened from another: the back arrow, then what the screen
 * is called.
 *
 * Each screen used to build this for itself, and no two agreed. The arrow sat at four
 * different heights and two different distances from the edge, so it jumped as you moved
 * between screens; the "+" was beside the title on Habits and Reminders but up by the arrow
 * on Expenses and Bills; and on Bills and Owed the title touched the card beneath it. One
 * component, so the frame around every screen is the same frame.
 *
 * It takes no side padding of its own: it sits inside the screen's content, which has the
 * gutter (`screen.gutter`), so the title lines up with everything under it.
 */
export function ScreenHeader({
  overline,
  overlineColor,
  title,
  subtitle,
  action,
  onBack,
  backLabel = 'Go back',
  gapBelow,
}: ScreenHeaderProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const titled = overline != null || title != null || subtitle != null;

  return (
    <View
      style={[
        styles.header,
        !titled && styles.headerBare,
        gapBelow != null && { marginBottom: gapBelow },
      ]}
    >
      <View style={styles.bar}>
        <Touchable
          onPress={onBack ?? (() => goBackOrHome(router))}
          style={styles.back}
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
        >
          <ArrowLeft size={22} color={t.textPrimary} strokeWidth={1.8} />
        </Touchable>

        {action}
      </View>

      {overline != null ? (
        <Text variant="overline" color={overlineColor ?? t.textFaint} style={styles.overline}>
          {overline}
        </Text>
      ) : null}

      {title != null ? (
        <Text
          variant="title"
          accessibilityRole="header"
          style={overline == null ? styles.titleAlone : styles.title}
        >
          {title}
        </Text>
      ) : null}

      {subtitle != null ? (
        <Text variant="body" color={t.textMuted} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A quiet round button for the header's right side, for an action on the thing the screen
 * shows (editing it). Quieter than `HeaderAdd`, which is for making something new.
 */
export function HeaderButton({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Touchable
      onPress={onPress}
      style={styles.quiet}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
    </Touchable>
  );
}

/** The round "+" at the top right of a screen that lists things: add one. */
export function HeaderAdd({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Touchable
      onPress={onPress}
      style={styles.add}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Plus size={22} color={t.onAccent} strokeWidth={2} />
    </Touchable>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    header: { marginBottom: spacing.xl },
    // Arrow only: the screen brings its own heading (a month switcher, a habit's name)
    // and its own space above it.
    headerBare: { marginBottom: 0 },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: MIN_TAP_TARGET,
    },
    back: {
      width: MIN_TAP_TARGET,
      height: MIN_TAP_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      // The arrow is drawn in the middle of its 44pt target. Pulled left by the slack, so
      // the glyph itself starts on the gutter, in line with the title under it.
      marginLeft: -spacing.md,
    },
    add: {
      width: MIN_TAP_TARGET,
      height: MIN_TAP_TARGET,
      borderRadius: radius.full,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quiet: {
      width: MIN_TAP_TARGET,
      height: MIN_TAP_TARGET,
      borderRadius: radius.full,
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    overline: { marginTop: spacing.base },
    title: { marginTop: spacing.xs },
    titleAlone: { marginTop: spacing.base },
    subtitle: { marginTop: spacing.sm },
  });
