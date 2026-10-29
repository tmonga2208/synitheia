import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBackOrHome } from '../src/navigation/goBackOrHome.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import {
  addMonths,
  formatMonthLabel,
  monthKeyOf,
  todayLocalDate,
  type LocalDate,
  type MonthKey,
  type MonthSummaryResponse,
} from '@synitheia/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { MonthGrid } from '../src/components/MonthGrid.js';
import { api } from '../src/api/client.js';
import { useAuth } from '../src/store/auth.js';
import { MIN_TAP_TARGET, radius, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import { flowTint, type Theme } from '../src/theme/theme.js';

function monthQuery(month: MonthKey) {
  return {
    queryKey: ['month', month] as const,
    queryFn: () => api.get<MonthSummaryResponse>(`/summary/month?month=${month}`),
  };
}

export default function History() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const user = useAuth((s) => s.user);
  const timezone = user?.timezone ?? 'UTC';
  const today = todayLocalDate(timezone);

  const [month, setMonth] = useState<MonthKey>(() => monthKeyOf(today));
  const queryClient = useQueryClient();

  const query = useQuery(monthQuery(month));
  const data = query.data;

  /**
   * The previous month is almost always the next tap. Prefetching it means the back
   * arrow paints instantly instead of flashing a skeleton for a month the user has
   * already lived through.
   */
  useEffect(() => {
    void queryClient.prefetchQuery(monthQuery(addMonths(month, -1)));
  }, [month, queryClient]);

  /**
   * Before the first response for THIS month lands, `data` is undefined and we have
   * no `earliestLocalDate` to compare against, so this alone would leave the bound
   * unenforced. `earliestDisabled` below closes that window by also disabling on
   * `query.isPending`, without needing any new state.
   */
  const atEarliest =
    data != null && month <= monthKeyOf(data.earliestLocalDate as LocalDate);

  /**
   * Tapping `‹` faster than a round trip would otherwise walk past the account's
   * earliest month: `atEarliest` can only be `true` once a response for the CURRENT
   * month has told us where that boundary is. Disabling while `query.isPending` too
   * means the control goes inert the instant a request is in flight, rather than
   * staying live for the gap between the tap and the bound catching up.
   */
  const earliestDisabled = atEarliest || query.isPending;

  /**
   * `atLatest` needs nothing from the server — `today` comes from the device/user
   * timezone alone — so it is correct on the very first render, before any request
   * has even started. No pending-query guard is needed here.
   */
  const atLatest = month >= monthKeyOf(today);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Back"
          haptic={false}
          onPress={() => goBackOrHome(router)}
          style={styles.iconButton}
        >
          <ChevronLeft size={24} color={t.textPrimary} strokeWidth={1.8} />
        </Touchable>
        <Text variant="heading">History</Text>
      </View>

      {/*
        The month bar lives OUTSIDE the loading/error/data switch below, rather than
        as one more branch inside it. Paging back is the whole point of this screen —
        keeping the label and the steppers on screen while a month loads means the
        user keeps their place instead of the entire body vanishing and reappearing
        under them on every tap.
      */}
      <View style={styles.monthBar}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          accessibilityState={{ disabled: earliestDisabled }}
          disabled={earliestDisabled}
          haptic={false}
          onPress={() => setMonth(addMonths(month, -1))}
          style={styles.iconButton}
        >
          <ChevronLeft
            size={20}
            // DELIBERATE LIGHT-MODE CHANGE — see the matching note on the next chevron and
            // in MonthGrid. Disabled was `palette.surfaceDim` #DBDAD7 (1.3303 on bone), now
            // `t.textFaint` #A3A3A0 (2.4065). Not a regression in a screenshot diff.
            color={earliestDisabled ? t.textFaint : t.textMuted}
            strokeWidth={1.8}
          />
        </Touchable>

        <Text variant="section">{formatMonthLabel(month)}</Text>

        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: atLatest }}
          disabled={atLatest}
          haptic={false}
          onPress={() => setMonth(addMonths(month, 1))}
          style={styles.iconButton}
        >
          <ChevronRight
            size={20}
            // DELIBERATE LIGHT-MODE CHANGE — the second of the two disabled month-stepper
            // chevrons. `palette.surfaceDim` #DBDAD7 (1.3303 on bone) → `t.textFaint`
            // #A3A3A0 (2.4065). `textFaint` is the documented role for a disabled control;
            // `t.border` would have been 1.3713 in dark — invisible. See the design spec's
            // "Light-mode changes" section.
            color={atLatest ? t.textFaint : t.textMuted}
            strokeWidth={1.8}
          />
        </Touchable>
      </View>

      {/*
        `LoadingState` rather than `SkeletonScreen`: this screen already owns a
        SafeAreaView, and SkeletonScreen brings its own — nesting the two doubles the
        top inset. LoadingState has neither a SafeAreaView nor a fixed horizontal
        padding of its own, so it drops in under the month bar without stacking
        insets or padding, and a plain "loading" read is honest here — a card-shaped
        skeleton would only be pretending to preview a calendar grid, not actually
        resembling one.
      */}
      {query.isPending ? (
        <LoadingState label={`Loading ${formatMonthLabel(month)}…`} />
      ) : query.isError ? (
        <View style={styles.state}>
          <ErrorState
            error={query.error}
            message="Couldn't load this month."
            onRetry={() => void query.refetch()}
          />
        </View>
      ) : !data ? null : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <MonthGrid
            month={month}
            days={data.days}
            today={today}
            onSelect={(localDate) => router.push(`/day/${localDate}`)}
          />

          <View style={styles.legend}>
            <Text variant="caption" color={t.textFaint}>
              less
            </Text>
            {[10, 45, 70, 100].map((percent) => (
              <View
                key={percent}
                style={[
                  styles.swatch,
                  { backgroundColor: flowTint(percent, t).background },
                ]}
              />
            ))}
            <Text variant="caption" color={t.textFaint}>
              more
            </Text>
          </View>

          {data.days.length === 0 ? (
            <EmptyState
              title={`Nothing logged in ${formatMonthLabel(month)}`}
              body="Days you track will show up here."
            />
          ) : (
            <>
              <SectionHeader title={`${formatMonthLabel(month)} at a glance`} />
              <View style={styles.stats}>
                <Stat value={`${data.stats.avgPercent}%`} label="average day" />
                <Stat value={String(data.stats.daysLogged)} label="days logged" />
                <Stat value={String(data.stats.bestFlowRun)} label="good days in a row" />
              </View>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Card style={styles.stat}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" color={t.textFaint}>
        {label}
      </Text>
    </Card>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: t.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing['4xl'],
    },
    /**
     * The month bar now sits outside the ScrollView (see the render method), so it
     * carries its own horizontal padding instead of inheriting `content`'s.
     */
    monthBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.base,
    },
    /** Wraps the error card with the same horizontal margin `content` gives the loaded state. */
    state: {
      paddingHorizontal: spacing.lg,
    },
    iconButton: {
      minWidth: MIN_TAP_TARGET,
      minHeight: MIN_TAP_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    legend: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: spacing.xs,
      marginTop: spacing.md,
    },
    swatch: {
      width: spacing.md,
      height: spacing.md,
      borderRadius: radius.sm / 2,
    },
    stats: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
      gap: spacing.xs,
    },
  });
