import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LocalDate, MonthKey } from '@synitheia/shared';
import { Skeleton, SkeletonCircle } from '../components/Skeleton.js';
import { Text } from '../components/primitives.js';
import { radius, spacing } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';
import { WEEKDAYS, weeksOf } from './MonthCalendar.js';
import { calendarCells } from './monthView.js';

const PAYEES = 5;
const ROWS = 4;

/**
 * The month view while it loads, in the month view's own shape: the total, the calendar for
 * this very month (its weeks and leading blanks, so nothing moves when the days fill in), the
 * payee circles and a few payment rows. The header and month switcher stay real above it.
 */
export function MonthSkeleton({ month, today }: { month: MonthKey; today: LocalDate }) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const weeks = useMemo(() => weeksOf(calendarCells(month, {}, today)), [month, today]);

  return (
    <View accessibilityLabel="Loading this month" accessible>
      <View style={styles.hero}>
        <Skeleton width="58%" height={46} round={radius.md} />
        <Skeleton width="42%" height={13} />
      </View>

      <View style={styles.calendar}>
        <View style={styles.week}>
          {WEEKDAYS.map((d, i) => (
            <Text key={i} variant="caption" color={t.textFaint} center style={styles.cell}>
              {d}
            </Text>
          ))}
        </View>
        {weeks.map((week, w) => (
          <View key={w} style={styles.week}>
            {week.map((cell, i) => (
              <View key={i} style={styles.cell}>
                {cell.kind === 'blank' ? null : (
                  <Skeleton round={radius.sm + 2} style={styles.square} />
                )}
              </View>
            ))}
          </View>
        ))}
      </View>

      <Skeleton width={72} height={10} style={styles.label} />
      <View style={styles.payees}>
        {Array.from({ length: PAYEES }, (_, i) => (
          <View key={i} style={styles.payee}>
            <SkeletonCircle size={44} />
            <Skeleton width={40} height={10} />
            <Skeleton width={34} height={10} />
          </View>
        ))}
      </View>

      <Skeleton width={96} height={10} style={styles.label} />
      <Skeleton width={64} height={11} style={styles.dayLabel} />
      {Array.from({ length: ROWS }, (_, i) => (
        <View key={i} style={styles.row}>
          <SkeletonCircle size={34} />
          <View style={styles.rowCopy}>
            <Skeleton width={`${62 - i * 7}%`} height={13} />
            <Skeleton width="34%" height={10} />
          </View>
          <Skeleton width={52} height={13} />
        </View>
      ))}
    </View>
  );
}

// Spacing mirrors the month view (expenses/index.tsx, MonthCalendar, PayeeStrip, PaymentRow).
const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    hero: { alignItems: 'center', marginTop: spacing.md, gap: spacing.sm },
    calendar: { gap: spacing.xs, marginTop: spacing.xl },
    week: { flexDirection: 'row', gap: spacing.xs },
    cell: { flex: 1 },
    square: { width: '100%', height: undefined, aspectRatio: 1 },
    label: { marginTop: spacing['2xl'], marginBottom: spacing.md },
    payees: { flexDirection: 'row', gap: spacing.base },
    payee: { alignItems: 'center', gap: spacing.xs, width: 56 },
    dayLabel: { marginTop: spacing.base, marginBottom: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 44,
      paddingVertical: spacing.sm,
    },
    rowCopy: { flex: 1, gap: 6 },
  });
