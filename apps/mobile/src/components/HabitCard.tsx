import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Check, Plus } from 'lucide-react-native';
import {
  HABIT_MEASURES,
  formatHabitProgress,
  formatHabitTarget,
  measureOf,
  type TodayResponse,
} from '@synitheia/shared';
import { Card, Text, Touchable } from './primitives.js';
import { iconFor } from './IconPicker.js';
import { MIN_TAP_TARGET, motion, radius, spacing } from '../theme/theme.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { accentFor } from '../theme/theme.js';

/** A habit as Today sees it: the domain record plus this local day's progress. */
export type TodayHabit = TodayResponse['habits'][number];

interface HabitCardProps {
  habit: TodayHabit;
  /** Opens the habit's detail screen. */
  onPress: (habit: TodayHabit) => void;
  /** Logs one occurrence. The parent owns the optimistic update. */
  onLog: (habit: TodayHabit) => void;
  /**
   * Takes one step back. Given, a tap on a completed habit undoes the last step, so a
   * habit ticked by mistake can be unticked; without it the check is a status, as before.
   */
  onUnlog?: (habit: TodayHabit) => void;
  /**
   * A past day. The affordance becomes a status glyph rather than a control —
   * history is a record, and a tappable checkbox on a finished day would be an
   * invitation to rewrite it.
   */
  readOnly?: boolean;
}

/**
 * "3,500 / 8,000 steps • Daily • 14D Streak".
 *
 * A habit that measures something shows where you are NOW, not just where you are going —
 * a bare goal on a half-finished habit is a worse affordance than a progress fraction. A
 * plain check has nothing to count, so it shows only the period and the streak.
 *
 * On a past day the streak segment is DROPPED, not recomputed. `/today` returns
 * `currentStreak` from the habit's live state regardless of the `localDate` it was asked
 * for — the same reason the day screen has no streak or XP chips — so "14D Streak" on a
 * July row asserts something about today, printed under a July date. The alternative,
 * showing that day's own count instead, is already in `goal` for anything countable and
 * has nothing to say about a check habit. Silence is the honest option.
 */
function metadataFor(habit: TodayHabit, readOnly: boolean): string {
  const period = habit.frequency === 'daily' ? 'Daily' : 'Weekly';
  const measure = measureOf(habit);

  const goal =
    measure === 'check'
      ? period
      : habit.todayComplete || habit.todayCount === 0
        ? `${formatHabitTarget(habit)} ${period.toLowerCase()}`
        : formatHabitProgress(habit, habit.todayCount);

  if (readOnly) return goal;

  // A zero streak is a beginning, not a failure. "0D Streak" reads as a scolding.
  const streak = habit.currentStreak > 0 ? `${habit.currentStreak}D Streak` : 'First Day';

  return [goal, streak].join(' • ');
}

/**
 * The habit row.
 *
 * Every card is tinted with its OWN accent — border, icon chip, metadata, and the
 * completion affordance. It is the most distinctive thing in the design language:
 * a list of habits should read as a list of individual rituals, not as rows in a table.
 */
export function HabitCard({ habit, onPress, onLog, onUnlog, readOnly = false }: HabitCardProps) {
  const t = useTheme();
  const accent = accentFor(habit.color, t);
  const { Icon } = iconFor(habit.icon);
  const measure = measureOf(habit);
  const isCounter = measure !== 'check';

  // 0 → open, 1 → complete. Everything that reacts to completion reads this one value,
  // so the wash, the ring fill, and the check all resolve together.
  const done = useSharedValue(habit.todayComplete ? 1 : 0);

  useEffect(() => {
    done.value = habit.todayComplete
      ? withSpring(1, motion.spring)
      : withTiming(0, { duration: motion.press.duration * 2 });
  }, [habit.todayComplete, done]);

  const washStyle = useAnimatedStyle(() => ({ opacity: done.value * 0.6 }));

  const affordanceStyle = useAnimatedStyle(() => ({
    // A gentle overshoot on completion — the one moment in the card worth celebrating.
    transform: [{ scale: interpolate(done.value, [0, 0.5, 1], [1, 1.12, 1]) }],
  }));

  const fillStyle = useAnimatedStyle(() => ({ opacity: done.value }));
  const plusStyle = useAnimatedStyle(() => ({ opacity: 1 - done.value }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: done.value }));

  const metadata = metadataFor(habit, readOnly);

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={`${habit.name}. ${metadata}.`}
      accessibilityHint={readOnly ? undefined : 'Opens this habit'}
      haptic={false}
      onPress={() => onPress(habit)}
    >
      <Card accent={accent.base} padded={false} style={styles.card}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: accent.wash }, washStyle]}
        />

        <View style={styles.row}>
          <View style={[styles.iconChip, { backgroundColor: accent.wash }]}>
            <Icon size={22} color={accent.text} strokeWidth={1.5} />
          </View>

          <View style={styles.copy}>
            <Text variant="cardTitle" numberOfLines={1}>
              {habit.name}
            </Text>
            <Text variant="caption" color={accent.text} numberOfLines={1}>
              {metadata}
            </Text>
          </View>

          <Touchable
            accessibilityRole={readOnly ? 'text' : 'checkbox'}
            accessibilityLabel={
              readOnly
                ? `${habit.name} ${habit.todayComplete ? 'was completed' : 'was not completed'}`
                : habit.todayComplete
                  ? `${habit.name} is complete for today`
                  : isCounter
                    ? `Add ${HABIT_MEASURES[measure].step} to ${habit.name}, ${formatHabitProgress(habit, habit.todayCount)}`
                    : `Complete ${habit.name}`
            }
            accessibilityHint={
              !readOnly && habit.todayComplete && onUnlog ? 'Takes the last step back' : undefined
            }
            accessibilityState={{
              checked: habit.todayComplete,
              disabled: habit.todayComplete && !onUnlog,
            }}
            // Guarded rather than `disabled`: Touchable dims disabled targets to 45%, and a
            // completed habit's check should read as an achievement, not a greyed-out control.
            onPress={() => {
              if (readOnly) return;
              if (!habit.todayComplete) onLog(habit);
              else onUnlog?.(habit);
            }}
            style={styles.affordanceTarget}
          >
            <Animated.View
              style={[styles.affordance, { borderColor: accent.base }, affordanceStyle]}
            >
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  styles.affordanceFill,
                  { backgroundColor: accent.base },
                  fillStyle,
                ]}
              />

              {isCounter && !readOnly ? (
                <Animated.View style={plusStyle}>
                  <Plus size={20} color={accent.base} strokeWidth={2} />
                </Animated.View>
              ) : null}

              <Animated.View style={[styles.check, checkStyle]}>
                {/* On the filled per-habit accent.base — t.onAccent's documented job is
                    exactly "glyphs, check marks... on a filled accent control". Measured
                    against all eight dark habit bases: 3.35-3.38:1, clearing the 3:1 WCAG
                    floor for non-text graphical objects (a checkmark icon, not body text). */}
                <Check size={20} color={t.onAccent} strokeWidth={2.5} />
              </Animated.View>
            </Animated.View>
          </Touchable>
        </View>
      </Card>
    </Touchable>
  );
}

const AFFORDANCE = 48;

const styles = StyleSheet.create({
  card: {
    // The wash sits under the content and must be clipped by the card's own radius.
    overflow: 'hidden',
    padding: spacing.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  iconChip: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  affordanceTarget: {
    minWidth: MIN_TAP_TARGET,
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  affordance: {
    width: AFFORDANCE,
    height: AFFORDANCE,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  affordanceFill: {
    borderRadius: radius.full,
  },
  check: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
