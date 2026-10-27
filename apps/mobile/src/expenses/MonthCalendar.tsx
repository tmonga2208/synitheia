import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { LocalDate } from '@synitheia/shared';
import { Text, Touchable } from '../components/primitives.js';
import { composite } from '../theme/contrast.js';
import { radius, spacing } from '../theme/theme.js';
import type { Theme } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import { formatAmount, type CalendarCell } from './monthView.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
/** The squares fill in as a wave, one day a beat after the one before. */
const STAGGER_MS = 20;

interface Props {
  cells: CalendarCell[];
  selected: LocalDate | null;
  onSelect: (date: LocalDate) => void;
  currency: string;
}

function spokenDate(date: LocalDate): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function weeksOf(cells: CalendarCell[]): CalendarCell[][] {
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    while (week.length < 7) week.push({ kind: 'blank' });
    weeks.push(week);
  }
  return weeks;
}

/**
 * The month as soft squares, stronger where more went out. A picture of the month before
 * any list: rent stands out on its day, quiet weeks look quiet.
 */
export function MonthCalendar({ cells, selected, onSelect, currency }: Props) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.calendar}>
      <View style={styles.week}>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} variant="caption" color={t.textFaint} center style={styles.cell}>
            {d}
          </Text>
        ))}
      </View>

      {weeksOf(cells).map((week, w) => (
        <View key={w} style={styles.week}>
          {week.map((cell, i) => {
            if (cell.kind === 'blank') return <View key={`b${i}`} style={styles.cell} />;

            const spent = cell.totalMinor > 0;
            const strong = cell.strength >= 0.6;
            const label = cell.future
              ? `${spokenDate(cell.date)}, still to come`
              : spent
                ? `${spokenDate(cell.date)}, ${formatAmount(cell.totalMinor, currency)} spent`
                : `${spokenDate(cell.date)}, nothing spent`;

            return (
              <Animated.View
                key={cell.date}
                entering={FadeIn.delay(cell.day * STAGGER_MS).duration(360)}
                style={styles.cell}
              >
                <Touchable
                  haptic={false}
                  disabled={cell.future || !spent}
                  onPress={() => onSelect(cell.date)}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ disabled: cell.future || !spent, selected: selected === cell.date }}
                  style={[
                    styles.square,
                    spent && { backgroundColor: composite(t.accent, 0.14 + cell.strength * 0.72, t.bg) },
                    cell.future && styles.future,
                    selected === cell.date && styles.selected,
                  ]}
                >
                  <Text variant="caption" color={strong ? t.onAccent : t.textMuted}>
                    {cell.day}
                  </Text>
                </Touchable>
              </Animated.View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    calendar: { gap: spacing.xs, marginTop: spacing.xl },
    week: { flexDirection: 'row', gap: spacing.xs },
    cell: { flex: 1 },
    square: {
      aspectRatio: 1,
      borderRadius: radius.sm + 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surface,
    },
    future: { opacity: 0.4 },
    selected: { borderWidth: 1.5, borderColor: t.textPrimary },
  });
