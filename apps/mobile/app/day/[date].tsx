import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react-native';
import {
  asMinor,
  formatDayLabel,
  formatMoney,
  isLocalDate,
  type LocalDate,
  type TodayResponse,
} from '@synitheia/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  SectionHeader,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { SkeletonList } from '../../src/components/Skeleton.js';
import { ProgressRing } from '../../src/components/ProgressRing.js';
import { HabitCard } from '../../src/components/HabitCard.js';
import { Timeline } from '../../src/components/Timeline.js';
import { api } from '../../src/api/client.js';
import { useAuth } from '../../src/store/auth.js';
import { MIN_TAP_TARGET, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import type { Theme } from '../../src/theme/theme.js';

/**
 * One past day, as a record.
 *
 * Nothing on this screen mutates data. Habit rows are tappable, but only to navigate
 * to that habit's own detail screen — read-only navigation, not editing. Timeline
 * entries are not interactive. Corrections are made through the relevant tracker
 * (the habit detail screen, the expense itself, and so on), which is what keeps
 * streaks and XP honest — they are never edited from here.
 *
 * Note what is deliberately absent: the streak and XP chips from Today. /today
 * returns those from the account's CURRENT state regardless of localDate, so
 * rendering them here would assert something false about this day. The spend /
 * water / calories row below is date-accurate and says more anyway.
 */
export default function Day() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ date: string }>();
  const user = useAuth((s) => s.user);

  const date = typeof params.date === 'string' ? params.date : '';
  const valid = isLocalDate(date);

  const query = useQuery({
    // A key of its own. Sharing Today's bare ['today'] key would let a past day
    // overwrite the live home screen in the cache.
    queryKey: ['day', date],
    queryFn: () => api.get<TodayResponse>(`/today?localDate=${date}`),
    enabled: valid,
  });

  const data = query.data;

  const totals = useMemo(() => {
    if (!data) return null;
    return [
      formatMoney(asMinor(data.expenses.totalMinor), user?.currency ?? 'INR'),
      `${data.water.totalMl} ml`,
      `${Math.round(data.nutrition.totals.calories)} kcal`,
    ].join('  ·  ');
  }, [data, user?.currency]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Back"
          haptic={false}
          onPress={() => router.back()}
          style={styles.back}
        >
          <ChevronLeft size={24} color={t.textPrimary} strokeWidth={1.8} />
        </Touchable>
        <Text variant="overline" color={t.textPrimary}>
          {valid ? formatDayLabel(date as LocalDate) : 'Unknown day'}
        </Text>
      </View>

      {!valid ? (
        <ErrorState message="That isn't a real date." onRetry={() => router.back()} />
      ) : query.isPending ? (
        // SkeletonList, not SkeletonScreen: this screen already has its own
        // SafeAreaView above, and SkeletonScreen wraps another one around its
        // content — nesting them doubles the top inset. SkeletonList is the same
        // card-row skeleton without that wrapper, which also happens to match this
        // screen's actual shape (a ring, then a stack of habit/timeline cards).
        <SkeletonList rows={4} />
      ) : query.isError ? (
        <ErrorState
          error={query.error}
          message="Couldn't load this day."
          onRetry={() => void query.refetch()}
        />
      ) : !data ? null : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.ring}>
            <ProgressRing percent={data.dailyFlow.percent} />
          </View>

          {totals ? (
            <Card style={styles.totals}>
              <Text variant="bodyMedium" color={t.textMuted}>
                {totals}
              </Text>
            </Card>
          ) : null}

          {data.habits.length > 0 ? (
            <>
              <SectionHeader title="Habits" />
              {data.habits.map((habit) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  readOnly
                  onPress={() => router.push(`/habit/${habit.id}`)}
                  onLog={() => undefined}
                />
              ))}
            </>
          ) : null}

          <SectionHeader title="Timeline" />
          {data.timeline.length > 0 ? (
            <Timeline events={data.timeline} timezone={user?.timezone ?? 'UTC'} />
          ) : (
            <EmptyState
              title="Nothing logged"
              body="No habits, expenses, or meals were recorded on this day."
            />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
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
      paddingBottom: spacing.base,
    },
    back: {
      minWidth: MIN_TAP_TARGET,
      minHeight: MIN_TAP_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing.md,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing['4xl'],
    },
    ring: {
      alignItems: 'center',
      marginVertical: spacing.xl,
    },
    totals: {
      alignItems: 'center',
      marginBottom: spacing.base,
    },
  });
