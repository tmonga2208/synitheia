import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { asLocalDate, localWeekdayIndex, type TodayResponse } from '@synitheia/shared';
import { Card, Text } from './primitives.js';
import { flowTint, motion, radius, spacing } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';

export type WeeklyDay = TodayResponse['weeklyFlow'][number];

interface WeeklyChartProps {
  /** Monday-anchored, seven entries. */
  days: WeeklyDay[];
}

/** Monday-first, matching startOfLocalWeek and the M–S columns in the design. */
const WEEKDAY_INITIAL = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const WEEKDAY_NAME = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const PLOT_HEIGHT = 132;
/** Room over each bar for its number; a full bar's top meets the goal line under it. */
const LABEL_SPACE = 20;
const BAR_SPACE = PLOT_HEIGHT - LABEL_SPACE;
/** A day with nothing logged still gets a visible stub — an absent bar reads as a rendering bug. */
const MIN_BAR_HEIGHT = 24;

/**
 * Weekly Analysis.
 *
 * Plain Views rather than SVG: seven rounded rectangles and a dashed rule need no
 * path maths, and staying in the view tree means the bars can be animated by the
 * same reanimated primitives as everything else in the app.
 */
export function WeeklyChart({ days }: WeeklyChartProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Today is left out: it is not over, and a morning would drag the average down.
  const past = days.filter((d) => !d.isToday && d.percent > 0);
  const average =
    past.length > 0
      ? Math.round(past.reduce((sum, d) => sum + d.percent, 0) / past.length)
      : null;

  return (
    <Card style={styles.card} elevated={false}>
      <View style={styles.header}>
        <Text variant="caption" color={t.textMuted}>
          How much of each day you did
        </Text>
        {average != null ? (
          <Text variant="caption" color={t.textPrimary}>
            {`Usually ${average}%`}
          </Text>
        ) : null}
      </View>

      <View style={styles.plot}>
        <View style={styles.goalLine} pointerEvents="none">
          <View style={styles.dash} />
          <Text variant="caption" color={t.textFaint}>
            Goal
          </Text>
        </View>

        {days.map((day, index) => (
          <Bar key={day.localDate} day={day} index={index} />
        ))}
      </View>

      <View style={styles.axis}>
        {days.map((day) => {
          const weekday = localWeekdayIndex(asLocalDate(day.localDate));
          return (
            <View key={day.localDate} style={styles.axisCell}>
              <Text variant="caption" color={day.isToday ? t.textPrimary : t.textFaint}>
                {WEEKDAY_INITIAL[weekday]}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function Bar({ day, index }: { day: WeeklyDay; index: number }) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const target = Math.max(MIN_BAR_HEIGHT, (day.percent / 100) * BAR_SPACE);

  const height = useSharedValue(MIN_BAR_HEIGHT);

  useEffect(() => {
    // Bars rise left-to-right, so the week reads as a sequence rather than a snapshot.
    height.value = withDelay(
      index * 60,
      withTiming(target, {
        duration: motion.ring.duration,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [target, index, height]);

  const animatedStyle = useAnimatedStyle(() => ({ height: height.value }));

  const weekday = localWeekdayIndex(asLocalDate(day.localDate));

  return (
    <View
      style={styles.column}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${WEEKDAY_NAME[weekday]}${day.isToday ? ', today' : ''}: ${day.percent} percent`}
    >
      <Text
        variant="caption"
        color={day.isToday ? t.textPrimary : t.textMuted}
        style={styles.barLabel}
      >
        {day.percent > 0 ? `${day.percent}` : ' '}
      </Text>
      <Animated.View
        style={[
          styles.bar,
          day.isToday
            ? { backgroundColor: t.accent, ...t.shadow.card }
            : // Past days take the History calendar's tint, so a strong day looks strong
              // here too rather than every finished day being the same grey.
              {
                backgroundColor:
                  day.percent > 0 ? flowTint(day.percent, t).background : t.border,
              },
          animatedStyle,
        ]}
      />
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      // The chart panel sits on the sage wash rather than bone — it is a plotted surface,
      // not another card of content, and the tint keeps it from competing with the habits.
      backgroundColor: t.accentWash,
      borderColor: t.accentWash,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.base,
    },
    plot: {
      height: PLOT_HEIGHT,
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    barLabel: { fontSize: 11, marginBottom: spacing.xs },
    goalLine: {
      position: 'absolute',
      top: LABEL_SPACE,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    dash: {
      flex: 1,
      borderTopWidth: 1,
      borderStyle: 'dashed',
      borderColor: t.accentSoft,
    },
    column: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    bar: {
      width: 22,
      borderRadius: radius.full,
    },
    axis: {
      flexDirection: 'row',
      marginTop: spacing.md,
    },
    axisCell: {
      flex: 1,
      alignItems: 'center',
    },
  });
