import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
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
import type { RecentDay } from '../habits/lastSeven.js';
import { fitsOnOneLine } from './metaLine.js';

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
   * For a habit measured in minutes, steps or a count: opens the log sheet, where the day's
   * real amount is set. Without it, "+" adds one step as before.
   */
  onAdjust?: (habit: TodayHabit) => void;
  /**
   * A past day. The affordance becomes a status glyph rather than a control —
   * history is a record, and a tappable checkbox on a finished day would be an
   * invitation to rewrite it.
   */
  readOnly?: boolean;
  /** The last seven days as dots under the name, oldest first. Shown only when given. */
  recent?: RecentDay[];
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
function metadataFor(
  habit: TodayHabit,
  readOnly: boolean,
): { goal: string; streak: string | null } {
  const period = habit.frequency === 'daily' ? 'Daily' : 'Weekly';
  const measure = measureOf(habit);

  const goal =
    measure === 'check'
      ? period
      : habit.todayComplete || habit.todayCount === 0
        ? `${formatHabitTarget(habit)} ${period.toLowerCase()}`
        : formatHabitProgress(habit, habit.todayCount);

  if (readOnly) return { goal, streak: null };

  // A zero streak is a beginning, not a failure. "0D Streak" reads as a scolding.
  const streak =
    habit.currentStreak > 0 ? `${habit.currentStreak}-day streak` : 'First day';

  return { goal, streak };
}

/** The dot between the two facts, with the space either side of it. */
const SEPARATOR = { dot: 3, gap: 6 } as const;
const SEPARATOR_WIDTH = SEPARATOR.dot + SEPARATOR.gap * 2;

/**
 * The line under a habit's name: where it stands, and its streak.
 *
 * Side by side when they fit; otherwise the streak takes a line of its own. It used to be
 * one line cut short — a walk part-way through its steps read "6,849 / 8,000 steps • 5-day
 * stre…", and the streak, the thing a habit is kept for, was what went missing.
 *
 * Each fact is laid out at its natural width and the two are measured, rather than letting
 * the text wrap where it runs out: a wrap could only fall mid-phrase or leave a dot at the
 * start of a line.
 */
function MetaLine({
  goal,
  streak,
  color,
}: {
  goal: string;
  streak: string | null;
  color: string;
}) {
  const [width, setWidth] = useState<{ box?: number; goal?: number; streak?: number }>({});

  const measure = (part: 'box' | 'goal' | 'streak') => (e: LayoutChangeEvent) => {
    const measured = Math.ceil(e.nativeEvent.layout.width);
    setWidth((seen) => (seen[part] === measured ? seen : { ...seen, [part]: measured }));
  };

  const known =
    width.box != null && width.goal != null && (streak == null || width.streak != null);
  const stacked =
    streak != null &&
    known &&
    !fitsOnOneLine(width.box ?? 0, [width.goal ?? 0, width.streak ?? 0], SEPARATOR_WIDTH);

  return (
    <View
      onLayout={measure('box')}
      // Hidden for the frame it takes to measure, so a long line is never seen running
      // under the button before it moves.
      style={[styles.meta, stacked && styles.metaStacked, !known && styles.metaUnmeasured]}
    >
      <Text variant="caption" color={color} numberOfLines={1} onLayout={measure('goal')}>
        {goal}
      </Text>
      {streak != null ? (
        <>
          {stacked ? null : <View style={[styles.metaDot, { backgroundColor: color }]} />}
          <Text variant="caption" color={color} numberOfLines={1} onLayout={measure('streak')}>
            {streak}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/**
 * The habit row.
 *
 * Every card is tinted with its OWN accent — border, icon chip, metadata, and the
 * completion affordance. It is the most distinctive thing in the design language:
 * a list of habits should read as a list of individual rituals, not as rows in a table.
 */
export function HabitCard({
  habit,
  onPress,
  onLog,
  onUnlog,
  onAdjust,
  readOnly = false,
  recent,
}: HabitCardProps) {
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

  const meta = metadataFor(habit, readOnly);
  const metadata = [meta.goal, meta.streak].filter((part) => part != null).join(' • ');

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
            <MetaLine goal={meta.goal} streak={meta.streak} color={accent.text} />
            {recent ? (
              <View
                style={styles.dots}
                accessible
                accessibilityLabel={`Done ${recent.filter((d) => d.state === 'done').length} of the last 7 days`}
              >
                {recent.map((day) => (
                  <View
                    key={day.localDate}
                    style={[
                      styles.dot,
                      day.state === 'none'
                        ? { borderWidth: 1, borderColor: accent.base, opacity: 0.5 }
                        : {
                            backgroundColor: accent.base,
                            opacity: day.state === 'done' ? 1 : 0.4,
                          },
                    ]}
                  />
                ))}
              </View>
            ) : null}
          </View>

          <Touchable
            accessibilityRole={readOnly ? 'text' : 'checkbox'}
            accessibilityLabel={
              readOnly
                ? `${habit.name} ${habit.todayComplete ? 'was completed' : 'was not completed'}`
                : isCounter && onAdjust
                  ? `Log ${habit.name}, ${formatHabitProgress(habit, habit.todayCount)}`
                  : habit.todayComplete
                    ? `${habit.name} is complete for today`
                    : isCounter
                      ? `Add ${HABIT_MEASURES[measure].step} to ${habit.name}, ${formatHabitProgress(habit, habit.todayCount)}`
                      : `Complete ${habit.name}`
            }
            accessibilityHint={
              !readOnly && habit.todayComplete && onUnlog
                ? 'Takes the last step back'
                : undefined
            }
            accessibilityState={{
              checked: habit.todayComplete,
              disabled: habit.todayComplete && !onUnlog,
            }}
            // Guarded rather than `disabled`: Touchable dims disabled targets to 45%, and a
            // completed habit's check should read as an achievement, not a greyed-out control.
            onPress={() => {
              if (readOnly) return;
              if (isCounter && onAdjust) onAdjust(habit);
              else if (!habit.todayComplete) onLog(habit);
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
  meta: { flexDirection: 'row', alignItems: 'center' },
  // flex-start, so each line keeps its natural width and can still be measured: stretched
  // to the box, a line could never be found short enough to go back beside the other.
  metaStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  metaUnmeasured: { opacity: 0 },
  metaDot: {
    width: SEPARATOR.dot,
    height: SEPARATOR.dot,
    borderRadius: radius.full,
    marginHorizontal: SEPARATOR.gap,
  },
  dots: { flexDirection: 'row', gap: 5, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: radius.full },
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
