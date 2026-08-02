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
import { MIN_TAP_TARGET, radius, spacing } from '../theme/theme.js';
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

  /**
   * Explicit rows of seven, rather than one wrapping container.
   *
   * A single `flexWrap` row of cells at `width: 100/7%` does NOT reliably fit seven
   * across: the percentage resolves to a fractional point value, Yoga rounds each cell
   * up to the pixel grid, and the row overflows by a fraction — so the seventh cell
   * wraps and every date lands one column to the left of its real weekday. The header
   * never showed it, because that row does not wrap and simply squeezed its seven labels.
   *
   * `monthGridCells` guarantees a multiple of seven, so chunking is total. Each cell is
   * `flex: 1` inside its row, which is exactly what the header does — one mechanism for
   * both, so they cannot drift apart again.
   */
  const rows = useMemo(() => {
    const out: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cells]);

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

      {rows.map((week, w) => (
        <View key={`week-${w}`} style={styles.row}>
          {week.map((localDate, i) => {
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
                    // DELIBERATE LIGHT-MODE CHANGE — one of only two on the dark-mode
                    // branch, so a light screenshot diff here is not a regression. The
                    // future-day numeral was `palette.surfaceDim` #DBDAD7 (1.3303 on bone)
                    // and is now `t.textFaint` #A3A3A0 (2.4065). `textFaint` is the
                    // documented role for a disabled control; the literal token swap,
                    // `t.border`, would have rendered these at 1.3713 in dark — invisible.
                    // Light gets slightly MORE legible as a side effect. See the
                    // "Light-mode changes" section of the design spec.
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
      ))}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
    },
    cell: {
      // One seventh of its row, by flex rather than by percentage. A percentage width
      // resolves to a fractional point value that Yoga rounds up per cell, which
      // overflows the row and wraps the seventh day onto the next line.
      flex: 1,
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
