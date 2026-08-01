import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
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
  SectionHeader,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { SkeletonScreen } from '../src/components/Skeleton.js';
import { MonthGrid } from '../src/components/MonthGrid.js';
import { api } from '../src/api/client.js';
import { useAuth } from '../src/store/auth.js';
import { MIN_TAP_TARGET, flowTint, palette, radius, spacing } from '../src/theme/tokens.js';

function monthQuery(month: MonthKey) {
  return {
    queryKey: ['month', month] as const,
    queryFn: () => api.get<MonthSummaryResponse>(`/summary/month?month=${month}`),
  };
}

export default function History() {
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
   * Before the first response lands, `data` is undefined and we have no
   * `earliestLocalDate` to compare against — so the earliest bound is simply not
   * enforced yet. That is intentional, not a gap: the account's earliest month is
   * never AFTER the current one, so the only bound that matters before data arrives
   * is `atLatest`, which needs nothing from the server at all.
   */
  const atEarliest =
    data != null && month <= monthKeyOf(data.earliestLocalDate as LocalDate);
  const atLatest = month >= monthKeyOf(today);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Back"
          haptic={false}
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <ChevronLeft size={24} color={palette.stone} strokeWidth={1.8} />
        </Touchable>
        <Text variant="heading">History</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.monthBar}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            accessibilityState={{ disabled: atEarliest }}
            disabled={atEarliest}
            haptic={false}
            onPress={() => setMonth(addMonths(month, -1))}
            style={styles.iconButton}
          >
            <ChevronLeft
              size={20}
              color={atEarliest ? palette.surfaceDim : palette.stoneMuted}
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
              color={atLatest ? palette.surfaceDim : palette.stoneMuted}
              strokeWidth={1.8}
            />
          </Touchable>
        </View>

        {query.isPending ? (
          <SkeletonScreen rows={5} showLeading={false} />
        ) : query.isError ? (
          <ErrorState
            message="Couldn't load this month."
            onRetry={() => void query.refetch()}
          />
        ) : !data ? null : (
          <>
            <MonthGrid
              month={month}
              days={data.days}
              today={today}
              onSelect={(localDate) => router.push(`/day/${localDate}`)}
            />

            <View style={styles.legend}>
              <Text variant="caption" color={palette.stoneFaint}>
                less
              </Text>
              {[10, 45, 70, 100].map((percent) => (
                <View
                  key={percent}
                  style={[
                    styles.swatch,
                    { backgroundColor: flowTint(percent).background },
                  ]}
                />
              ))}
              <Text variant="caption" color={palette.stoneFaint}>
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
                  <Stat value={`${data.stats.avgPercent}%`} label="avg flow" />
                  <Stat value={String(data.stats.daysLogged)} label="days logged" />
                  <Stat value={String(data.stats.bestFlowRun)} label="best run" />
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card style={styles.stat}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" color={palette.stoneFaint}>
        {label}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bone,
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
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.base,
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
    width: 14,
    height: 14,
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
