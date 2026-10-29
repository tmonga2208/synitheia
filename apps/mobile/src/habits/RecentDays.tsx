import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  addLocalDays,
  asLocalDate,
  formatDayLabel,
  localWeekdayIndex,
  type LocalDate,
} from '@synitheia/shared';
import { Text } from '../components/primitives.js';
import { radius, spacing } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';
import type { HabitHistory } from '../api/types.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const WEEKS = 4;

interface RecentDaysProps {
  logs: HabitHistory['logs'];
  today: LocalDate;
  color: string;
}

/**
 * The last four weeks as a grid, Monday first, ending with this week. Four, not five,
 * because the screen loads 30 days of history and a fifth week would reach past it.
 *
 * Done days are filled, days with some progress are a soft step of the habit's colour,
 * and untouched days are an outline — the same three states as the History calendar,
 * so the two read alike.
 */
export function RecentDays({ logs, today, color }: RecentDaysProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  const byDate = useMemo(() => new Map(logs.map((l) => [l.localDate, l])), [logs]);

  const weeks = useMemo(() => {
    const monday = addLocalDays(today, -localWeekdayIndex(today));
    const first = addLocalDays(monday, -7 * (WEEKS - 1));
    return Array.from({ length: WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => addLocalDays(first, w * 7 + d)),
    );
  }, [today]);

  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        {WEEKDAYS.map((label, i) => (
          <View key={`${label}-${i}`} style={styles.headerCell}>
            <Text variant="caption" color={t.textFaint}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      {weeks.map((week) => (
        <View key={week[0]} style={styles.row}>
          {week.map((day) => {
            const future = day > today;
            const log = byDate.get(day);
            const done = log?.complete === true;
            const some = !done && (log?.count ?? 0) > 0;

            return (
              <View
                key={day}
                style={styles.cellWrap}
                accessible={!future}
                accessibilityRole="text"
                accessibilityLabel={`${formatDayLabel(asLocalDate(day))}: ${
                  done ? 'done' : some ? 'partly done' : 'not done'
                }`}
              >
                <View
                  style={[
                    styles.cell,
                    future
                      ? null
                      : done
                        ? { backgroundColor: color }
                        : some
                          ? { backgroundColor: color, opacity: 0.4 }
                          : styles.empty,
                    day === today && styles.today,
                  ]}
                />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    grid: { gap: spacing.sm },
    row: { flexDirection: 'row', gap: spacing.sm },
    headerCell: { flex: 1, alignItems: 'center' },
    cellWrap: { flex: 1, aspectRatio: 1, maxHeight: 40 },
    cell: { flex: 1, borderRadius: radius.sm },
    empty: { borderWidth: 1, borderColor: t.border },
    today: { borderWidth: 1.5, borderColor: t.textMuted },
  });
