import { useMemo, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Button, Text, Touchable } from './primitives.js';
import { radius, spacing } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';

/**
 * When something happened.
 *
 * This is a self-contained calendar, deliberately NOT the OS date picker. The native
 * picker (@react-native-community/datetimepicker) does not register its Fabric component
 * under this app's New-Architecture + Expo + hoisted-monorepo build — its native code
 * never links in, and every render of it crashes with "view config undefined". A picker
 * that cannot be built is worse than a plain one that can: this one is pure React Native,
 * so it renders the same on both platforms and cannot break the native build.
 *
 * It edits the DAY only. The time-of-day of the existing instant is preserved untouched —
 * an expense's exact minute is not something anyone sits and dials in, and the server
 * buckets by local day regardless. A future day is unreachable: an expense you have not
 * made yet is not an expense, and letting one be filed silently corrupts "this month".
 */

interface DateFieldProps {
  label: string;
  value: Date;
  onChange: (next: Date) => void;
  /** The timezone the date is READ in, so the label matches the day the app files it under. */
  timezone: string;
  disabled?: boolean;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The calendar works in whole local days; the clock inside a day never changes here. */
interface YMD {
  year: number;
  month: number; // 0-indexed
  day: number;
}

/**
 * The calendar-day parts of an instant AS SEEN in a timezone.
 *
 * Doing this by hand rather than with getFullYear() matters: an expense at 01:00 IST is
 * still "today" to the user, but 19:30 UTC the PREVIOUS day to the device. The grid must
 * show the day the user lives in, which is the same day the server files the expense under.
 */
function partsInZone(date: Date, timeZone: string): YMD {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

/**
 * Move an instant to a different calendar day WITHOUT disturbing its time-of-day.
 *
 * The naive `new Date(y, m, d)` throws the original clock away and re-reads it in the
 * device timezone, so re-dating a 9am-IST coffee from a US phone would land it at a
 * different hour and possibly flip the local day. Shifting by whole-day deltas from the
 * original instant keeps the exact same moment-of-day, which is the only correct thing to
 * preserve when all the user touched was the date.
 */
function withDay(original: Date, target: YMD, timeZone: string): Date {
  const current = partsInZone(original, timeZone);
  const currentUtc = Date.UTC(current.year, current.month, current.day);
  const targetUtc = Date.UTC(target.year, target.month, target.day);
  const dayDelta = Math.round((targetUtc - currentUtc) / 86_400_000);
  return new Date(original.getTime() + dayDelta * 86_400_000);
}

function sameDay(a: YMD, b: YMD): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function isAfter(a: YMD, b: YMD): boolean {
  return (
    Date.UTC(a.year, a.month, a.day) > Date.UTC(b.year, b.month, b.day)
  );
}

export function DateField({
  label,
  value,
  onChange,
  timezone,
  disabled = false,
}: DateFieldProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  // The month being browsed. Seeded to the value's month each time the sheet opens, so
  // reopening never strands the user on a month they navigated away to last time.
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const p = partsInZone(value, timezone);
    return { year: p.year, month: p.month };
  });

  const selected = partsInZone(value, timezone);
  const today = partsInZone(new Date(), timezone);

  const formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(value);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(view.year, view.month, 1))),
    [view],
  );

  /** The day cells for the visible month, padded so the 1st lands on its weekday. */
  const cells = useMemo<(number | null)[]>(() => {
    const firstWeekday = new Date(Date.UTC(view.year, view.month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
    const out: (number | null)[] = Array.from({ length: firstWeekday }, () => null);
    for (let d = 1; d <= daysInMonth; d += 1) out.push(d);
    return out;
  }, [view]);

  function openPicker() {
    setView({ year: selected.year, month: selected.month });
    setOpen(true);
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  // Do not let the user page into a month that is entirely in the future.
  const canGoNext = !(
    view.year > today.year ||
    (view.year === today.year && view.month >= today.month)
  );

  function pick(day: number) {
    const target: YMD = { year: view.year, month: view.month, day };
    if (isAfter(target, today)) return; // future day — inert
    onChange(withDay(value, target, timezone));
    setOpen(false);
  }

  const field = (
    <Touchable
      onPress={openPicker}
      disabled={disabled}
      style={[styles.field, disabled && styles.fieldDisabled]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${formatted}. Tap to change.`}
    >
      <CalendarDays size={18} color={t.textMuted} strokeWidth={1.8} />
      <View style={{ flex: 1 }}>
        <Text variant="caption" color={t.textMuted}>
          {label}
        </Text>
        <Text variant="bodyMedium">{formatted}</Text>
      </View>
    </Touchable>
  );

  return (
    <>
      {field}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.scrim}>
          <View style={styles.sheet}>
            <View style={styles.monthRow}>
              <Touchable
                onPress={() => shiftMonth(-1)}
                style={styles.arrow}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
              >
                <ChevronLeft size={22} color={t.textPrimary} strokeWidth={1.8} />
              </Touchable>

              <Text variant="cardTitle">{monthLabel}</Text>

              <Touchable
                onPress={() => canGoNext && shiftMonth(1)}
                disabled={!canGoNext}
                style={[styles.arrow, !canGoNext && styles.arrowDisabled]}
                accessibilityRole="button"
                accessibilityLabel="Next month"
              >
                <ChevronRight size={22} color={t.textPrimary} strokeWidth={1.8} />
              </Touchable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((d, i) => (
                <Text
                  key={i}
                  variant="caption"
                  color={t.textFaint}
                  style={styles.weekday}
                >
                  {d}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((day, i) => {
                if (day === null) return <View key={`pad-${i}`} style={styles.cell} />;

                const cellYmd: YMD = { year: view.year, month: view.month, day };
                const isSelected = sameDay(cellYmd, selected);
                const isToday = sameDay(cellYmd, today);
                const isFuture = isAfter(cellYmd, today);

                return (
                  <Touchable
                    key={day}
                    onPress={() => pick(day)}
                    disabled={isFuture}
                    style={[styles.cell, isSelected && styles.cellSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected, disabled: isFuture }}
                    accessibilityLabel={`${monthLabel} ${day}${isToday ? ', today' : ''}`}
                  >
                    <Text
                      variant="body"
                      // The selected day sits on a filled t.accent circle (styles.cellSelected).
                      // t.bg is the correct token here rather than t.onAccent: dark's onAccent
                      // is DEFINED as dark bg (see theme.ts), so this reads correctly against
                      // the filled circle in both themes while staying byte-identical to the
                      // pre-conversion `palette.bone` in light (t.onAccent's light value is
                      // pure white, a different literal from bone).
                      color={
                        isSelected
                          ? t.bg
                          : isFuture
                            ? t.textFaint
                            : t.textPrimary
                      }
                    >
                      {day}
                    </Text>
                    {isToday && !isSelected ? <View style={styles.todayDot} /> : null}
                  </Touchable>
                );
              })}
            </View>

            <View style={styles.actions}>
              <Button
                label="Today"
                variant="ghost"
                onPress={() => {
                  onChange(withDay(value, today, timezone));
                  setOpen(false);
                }}
              />
              <Button label="Close" style={{ flex: 1 }} onPress={() => setOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const CELL = 44;

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 56,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.border,
    },
    fieldDisabled: { opacity: 0.5 },
    scrim: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: t.scrim,
    },
    // A real bottom sheet: transparent Modal, slides up over the scrim.
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      paddingBottom: spacing['2xl'],
    },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    arrow: {
      width: CELL,
      height: CELL,
      alignItems: 'center',
      justifyContent: 'center',
    },
    arrowDisabled: { opacity: 0.3 },
    weekRow: { flexDirection: 'row' },
    weekday: { width: CELL, textAlign: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: {
      width: CELL,
      height: CELL,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: CELL / 2,
    },
    cellSelected: { backgroundColor: t.accent },
    todayDot: {
      position: 'absolute',
      bottom: 6,
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.accent,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginTop: spacing.lg,
    },
  });
