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
import { motion, palette, radius, shadow, spacing } from '../theme/tokens.js';

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
  return (
    <Card style={styles.card} elevated={false}>
      <View style={styles.plot}>
        <View style={styles.goalLine} pointerEvents="none">
          <View style={styles.dash} />
          <Text variant="caption" color={palette.stoneFaint}>
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
              <Text
                variant="caption"
                color={day.isToday ? palette.stone : palette.stoneFaint}
              >
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
  const target = Math.max(MIN_BAR_HEIGHT, (day.percent / 100) * PLOT_HEIGHT);

  const height = useSharedValue(MIN_BAR_HEIGHT);

  useEffect(() => {
    // Bars rise left-to-right, so the week reads as a sequence rather than a snapshot.
    height.value = withDelay(
      index * 60,
      withTiming(target, { duration: motion.ring.duration, easing: Easing.out(Easing.cubic) }),
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
      <Animated.View
        style={[
          styles.bar,
          day.isToday
            ? { backgroundColor: palette.sage, ...shadow.card }
            : { backgroundColor: palette.surfaceDim },
          animatedStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // The chart panel sits on the sage wash rather than bone — it is a plotted surface,
    // not another card of content, and the tint keeps it from competing with the habits.
    backgroundColor: palette.sageWash,
    borderColor: palette.sageWash,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.base,
  },
  plot: {
    height: PLOT_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  goalLine: {
    position: 'absolute',
    top: 0,
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
    borderColor: palette.sageSoft,
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
