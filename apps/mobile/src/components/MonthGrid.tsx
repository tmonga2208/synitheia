import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  formatDayLabel,
  monthGridCells,
  type LocalDate,
  type MonthDay,
  type MonthKey,
} from '@synitheia/shared';
import { Text, Touchable } from './primitives.js';
import { MIN_TAP_TARGET, radius, spacing } from '../theme/tokens.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import { flowTint, type Theme } from '../theme/theme.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

interface MonthGridProps {
  month: MonthKey;
  days: readonly MonthDay[];
  /** The user's today, so the current day can be marked and later days disabled. */
  today: LocalDate;
  onSelect: (localDate: LocalDate) => void;
}

/**
 * The month as a Monday-anchored grid of days, tinted by that day's flow.
 *
 * Purely presentational — it fetches nothing and owns no selection state. Three
 * distinct cell states, and conflating any two of them would be a lie:
 *
 *   null cell   — not a date in this month. Empty space.
 *   hollow cell — a real date with nothing logged. Outline only.
 *   tinted cell — a real date with a real percentage.
 */
export function MonthGrid({ month, days, today, onSelect }: MonthGridProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const cells = useMemo(() => monthGridCells(month), [month]);

  const byDate = useMemo(
    () => new Map(days.map((d) => [d.localDate as string, d])),
    [days],
  );

  return (
    <View>
      <View style={styles.row}>
        {WEEKDAYS.map((label, i) => (
          <View key={`${label}-${i}`} style={styles.cell}>
            <Text variant="caption" color={t.textFaint}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((localDate, i) => {
          if (localDate === null) {
            return <View key={`blank-${i}`} style={styles.cell} />;
          }

          const day = byDate.get(localDate);
          const isToday = localDate === today;
          const isFuture = localDate > today;
          const tint = day ? flowTint(day.percent, t) : null;

          const label = formatDayLabel(localDate);
          const description = isFuture
            ? `${label}, hasn't happened yet`
            : day
              ? `${label}, ${day.percent} percent`
              : `${label}, nothing logged`;

          return (
            <Touchable
              key={localDate}
              accessibilityRole="button"
              accessibilityLabel={description}
              accessibilityState={{ disabled: isFuture }}
              accessibilityHint={isFuture ? undefined : 'Opens this day'}
              haptic={false}
              disabled={isFuture}
              onPress={() => onSelect(localDate)}
              style={styles.cell}
            >
              <View
                style={[
                  styles.day,
                  tint ? { backgroundColor: tint.background } : styles.hollow,
                  isToday && styles.today,
                ]}
              >
                <Text
                  variant="caption"
                  color={
                    isFuture
                      ? t.textFaint
                      : (tint?.text ?? t.textMuted)
                  }
                >
                  {Number(localDate.slice(8, 10))}
                </Text>
              </View>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cell: {
      // Seven per row, and the aspect ratio keeps every cell square at any width.
      width: `${100 / 7}%`,
      aspectRatio: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: MIN_TAP_TARGET,
      padding: spacing.xs / 2,
    },
    day: {
      flex: 1,
      alignSelf: 'stretch',
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // A real date with nothing logged — outline only, distinct from a tinted cell.
    hollow: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    today: {
      borderWidth: 1.5,
      borderColor: t.accentSoft,
    },
  });
