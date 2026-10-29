import { StyleSheet, View } from 'react-native';
import { asLocalDate, localWeekdayIndex } from '@synitheia/shared';
import { Text } from './primitives.js';
import { radius, spacing } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';

export interface WeekStripDay {
  localDate: string;
  value: number;
  isToday: boolean;
}

interface WeekStripProps {
  /** Seven days, oldest first. */
  days: WeekStripDay[];
  /** The bar is full at the target. Without one, the week's highest day fills it. */
  target?: number | null;
  color: string;
  /** The short number over each bar. Empty days get none. */
  format: (value: number) => string;
  /** Spoken per bar, e.g. "1.2 litres". */
  describe: (value: number) => string;
  /** Shorter bars and no numbers, for a row inside a list. */
  compact?: boolean;
  /**
   * Draw days that reached the target in the full colour. Off where reaching it is not
   * the point — eating past a calorie target is not an achievement.
   */
  highlightMet?: boolean;
}

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

/**
 * A week as seven short bars, each on a faint track of its own colour — the same idea
 * as the rings' tracks.
 *
 * Days that reached the target are drawn in the full colour and the rest in a softer
 * step, so "which days did I make it" reads without reading a single number.
 */
export function WeekStrip({
  days,
  target,
  color,
  format,
  describe,
  compact,
  highlightMet = true,
}: WeekStripProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const highest = Math.max(1, ...days.map((d) => d.value));
  // Where reaching the target is the goal, a full bar means "made it". Elsewhere the bar
  // scales to the week's highest day too, so days past the target still differ.
  const ceiling =
    target && target > 0 ? (highlightMet ? target : Math.max(target, highest)) : highest;
  const plot = compact ? 36 : 64;

  return (
    <View style={styles.row}>
      {days.map((day) => {
        const weekday = localWeekdayIndex(asLocalDate(day.localDate));
        const share = Math.min(1, day.value / ceiling);
        const met = highlightMet && target != null && target > 0 && day.value >= target;
        // A logged day never disappears into the track, however small it was.
        const height = day.value > 0 ? Math.max(compact ? 4 : 6, share * plot) : 0;

        return (
          <View
            key={day.localDate}
            style={styles.column}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${WEEKDAY_NAME[weekday]}${day.isToday ? ', today' : ''}: ${
              day.value > 0 ? describe(day.value) : 'nothing logged'
            }`}
          >
            {compact ? null : (
              <Text
                variant="caption"
                color={day.isToday ? t.textPrimary : t.textMuted}
                style={styles.value}
                numberOfLines={1}
              >
                {day.value > 0 ? format(day.value) : ' '}
              </Text>
            )}
            <View style={[styles.track, { height: plot, width: compact ? 10 : 14 }]}>
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: color, opacity: 0.16 },
                ]}
              />
              <View
                style={[
                  styles.fill,
                  {
                    height,
                    backgroundColor: color,
                    opacity: met || day.isToday ? 1 : 0.55,
                  },
                ]}
              />
            </View>
            {compact ? null : (
              <Text
                variant="caption"
                color={day.isToday ? t.textPrimary : t.textFaint}
                style={styles.weekday}
              >
                {WEEKDAY_INITIAL[weekday]}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row' },
    column: { flex: 1, alignItems: 'center' },
    value: { marginBottom: spacing.xs, fontSize: 11 },
    track: {
      borderRadius: radius.full,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    fill: { width: '100%', borderRadius: radius.full },
    weekday: { marginTop: spacing.sm },
  });
