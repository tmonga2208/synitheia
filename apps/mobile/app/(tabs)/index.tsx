import { useCallback, useMemo, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronRight, Info, Leaf, Sparkles, Zap } from 'lucide-react-native';
import {
  asMinor,
  formatMoney,
  type SupportingMetric,
  type TodayResponse,
  HABIT_MEASURES,
  measureOf,
} from '@synitheia/shared';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  SectionHeader,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { SkeletonToday } from '../../src/components/Skeleton.js';
import { ProgressRing } from '../../src/components/ProgressRing.js';
import { HabitCard, type TodayHabit } from '../../src/components/HabitCard.js';
import { WeeklyChart } from '../../src/components/WeeklyChart.js';
import { Timeline } from '../../src/components/Timeline.js';
import { ApiError, api } from '../../src/api/client.js';
import { useHealthSync } from '../../src/health/useHealthSync.js';
import { useAuth } from '../../src/store/auth.js';
import { MIN_TAP_TARGET, palette, radius, spacing } from '../../src/theme/tokens.js';

const TODAY_KEY = ['today'] as const;

/**
 * A LocalDate is a bare calendar label with no timezone attached. Anchoring it at UTC
 * midnight and formatting it *in UTC* is the only way to render it without some zone
 * silently shifting it a day — which is exactly the class of bug local-date.ts exists
 * to prevent.
 */
function formatOverline(localDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${localDate}T00:00:00Z`));
}

function formatMetric(metric: SupportingMetric, currency: string): string {
  switch (metric.unit) {
    case 'minor_currency':
      return formatMoney(asMinor(Math.round(metric.value)), currency);
    case 'ml':
      return `${Math.round(metric.value)} ml`;
    case 'kcal':
      return `${Math.round(metric.value)} kcal`;
    case 'percent':
      return `${Math.round(metric.value)}%`;
    case 'minutes':
      return `${Math.round(metric.value)} min`;
    case 'ratio':
      return `${metric.value.toFixed(2)}×`;
    case 'count':
      return String(Math.round(metric.value));
  }
}

export default function Today() {
  /**
   * Apple Health, pulled on every foreground.
   *
   * Here rather than in a provider because Today is where the result lands: steps fill a
   * step habit, which moves the ring the user is looking at the moment they open the app.
   */
  const healthSources = useQuery({
    queryKey: ['data-sources'],
    queryFn: () => api.get<{ items: { source: string; status: string }[] }>('/data-sources'),
  });

  const healthConnected =
    healthSources.data?.items.some((s) => s.source === 'health' && s.status === 'connected') ??
    false;

  useHealthSync(healthConnected);

  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => api.get<TodayResponse>('/today'),
  });

  /**
   * The optimistic log.
   *
   * A checkbox that waits on a round trip is a checkbox that feels broken. The cache is
   * updated before the request leaves, rolled back on failure, and reconciled from the
   * server once it settles — the server owns the streak and the ring, the client only
   * owns the next 300ms.
   */
  const logHabit = useMutation({
    mutationFn: (habit: TodayHabit) =>
      // One tap adds one STEP of this habit's measure, not one unit. A step goal that
      // moved 1 at a time would need 8,000 taps.
      api.post<unknown>(`/habits/${habit.id}/log`, {
        increment: HABIT_MEASURES[measureOf(habit)].step,
      }),

    onMutate: async (habit: TodayHabit) => {
      await queryClient.cancelQueries({ queryKey: TODAY_KEY });
      const previous = queryClient.getQueryData<TodayResponse>(TODAY_KEY);

      queryClient.setQueryData<TodayResponse>(TODAY_KEY, (current) =>
        current
          ? {
              ...current,
              habits: current.habits.map((h) => {
                if (h.id !== habit.id) return h;
                const todayCount = h.todayCount + HABIT_MEASURES[measureOf(h)].step;
                return { ...h, todayCount, todayComplete: todayCount >= h.targetCount };
              }),
            }
          : current,
      );

      return { previous };
    },

    onError: (_error, _habit, context) => {
      if (context?.previous) queryClient.setQueryData(TODAY_KEY, context.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: TODAY_KEY }),
  });

  const resolveSuggestion = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'confirm' | 'reject' }) =>
      api.post<unknown>(`/inferences/${id}/resolve`, { action }),

    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: TODAY_KEY });
      const previous = queryClient.getQueryData<TodayResponse>(TODAY_KEY);

      // The card leaves the moment the user answers. Leaving it on screen pending a
      // response makes the app feel like it did not hear them.
      queryClient.setQueryData<TodayResponse>(TODAY_KEY, (current) =>
        current
          ? { ...current, suggestions: current.suggestions.filter((s) => s.id !== id) }
          : current,
      );

      return { previous };
    },

    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(TODAY_KEY, context.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: TODAY_KEY }),
  });

  const openHabit = useCallback((habit: TodayHabit) => {
    router.push(`/habit/${habit.id}`);
  }, []);

  const { data, error, isPending, isRefetching, refetch } = query;

  const overline = useMemo(
    () => (data ? formatOverline(data.localDate) : ''),
    [data],
  );

  const firstName = user?.name.split(' ')[0] ?? 'there';
  const timezone =
    user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const currency = user?.currency ?? 'INR';

  if (isPending) return <SkeletonToday />;

  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          <ErrorState
            message={
              error instanceof ApiError || error instanceof Error
                ? error.message
                : 'We could not load your day.'
            }
            onRetry={() => void refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={palette.sage}
          />
        }
      >
        {/* ─── Header ──────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Your profile"
            haptic={false}
            onPress={() => router.push('/(tabs)/profile')}
            style={styles.avatarTarget}
          >
            {user?.avatarUrl ? (
              <Image
                source={{ uri: user.avatarUrl }}
                style={styles.avatar}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text variant="cardTitle" color={palette.white}>
                  {firstName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </Touchable>

          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Reminders and notifications"
            haptic={false}
            onPress={() => router.push('/(tabs)/reminders')}
            style={styles.iconButton}
          >
            <Bell size={22} color={palette.stone} strokeWidth={1.6} />
          </Touchable>
        </View>

        {/* ─── Greeting ────────────────────────────────────────────────────── */}
        <Text variant="overline" color={palette.stone}>
          {overline}
        </Text>
        <Text variant="title" style={styles.greeting}>
          {`${data.greeting}, ${firstName}`}
        </Text>
        <Text variant="body" color={palette.stoneFaint} style={styles.subtitle}>
          {data.streakDays > 0
            ? `You're on a ${data.streakDays}-day streak. Keep the momentum.`
            : 'Take a deep breath and start your journey.'}
        </Text>

        {/* ─── Daily Flow ──────────────────────────────────────────────────── */}
        <View style={styles.ring}>
          <ProgressRing percent={data.dailyFlow.percent} />
        </View>

        <View style={styles.chips}>
          {/* At zero these become an invitation rather than a score of nothing. */}
          <Chip
            label={data.streakDays > 0 ? `${data.streakDays} Day Streak` : 'Streaks'}
            icon={<Zap size={14} color={palette.stone} strokeWidth={2} />}
            accessibilityRole="text"
            haptic={false}
          />
          <Chip
            label={data.xp > 0 ? `${data.xp} XP` : 'Start Collecting'}
            accessibilityRole="text"
            haptic={false}
          />
        </View>

        {/* ─── Daily Habits ────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader
            title="Daily Habits"
            action={data.habits.length > 0 ? 'View All' : undefined}
            onAction={() => router.push('/(tabs)/habits')}
          />

          {data.habits.length === 0 ? (
            <EmptyState
              icon={<Leaf size={30} color={palette.white} strokeWidth={1.5} />}
              title="No Rituals Yet"
              body="Your ritual is a blank canvas. Start small to build a life of intention."
              actionLabel="+ Add A New Habit"
              onAction={() => router.push('/habit/new')}
            />
          ) : (
            <View style={styles.habits}>
              {data.habits.map((habit) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  onPress={openHabit}
                  onLog={(h) => logHabit.mutate(h)}
                />
              ))}
            </View>
          )}
        </View>

        {/* ─── Suggestions ─────────────────────────────────────────────────── */}
        {data.suggestions.length > 0 ? (
          <View style={styles.suggestions}>
            {data.suggestions.map((suggestion) => (
              <Card key={suggestion.id} style={styles.suggestion}>
                <View style={styles.tagRow}>
                  <View style={styles.tag}>
                    <Text variant="caption" color={palette.stoneFaint}>
                      detected
                    </Text>
                  </View>
                </View>

                <Text variant="cardTitle">{suggestion.title}</Text>

                {suggestion.description ? (
                  <Text variant="body" color={palette.stoneMuted}>
                    {suggestion.description}
                  </Text>
                ) : null}

                {/* The evidence, in the user's own terms. A suggestion the user cannot
                    check is a suggestion they can only obey or ignore. */}
                {suggestion.evidence.map((item) => (
                  <Text
                    key={`${suggestion.id}:${item.label}`}
                    variant="caption"
                    color={palette.stoneFaint}
                  >
                    {`• ${item.label}`}
                  </Text>
                ))}

                <View style={styles.suggestionActions}>
                  <Button
                    label="Dismiss"
                    variant="secondary"
                    fullWidth={false}
                    style={styles.suggestionButton}
                    onPress={() =>
                      resolveSuggestion.mutate({ id: suggestion.id, action: 'reject' })
                    }
                  />
                  <Button
                    label="Confirm"
                    fullWidth={false}
                    style={styles.suggestionButton}
                    onPress={() =>
                      resolveSuggestion.mutate({ id: suggestion.id, action: 'confirm' })
                    }
                  />
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        {/* ─── Weekly Analysis ─────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Weekly Analysis" />
          <WeeklyChart days={data.weeklyFlow} />
        </View>

        {/* ─── Timeline ────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Your Day" />
          <Timeline events={data.timeline} timezone={timezone} />
        </View>

        {/*
          ─── Synítheia AI ───────────────────────────────────────────────────
          Directly under the day it is talking about, rather than in a tab of its own that
          sits empty until the user turns the AI on. One insight here; the rest is one tap
          away. It renders nothing at all when there is nothing to say — the whole point of
          the layer is that silence is a valid answer.
        */}
        {data.featuredInsight ? (
          <View style={styles.section}>
            <SectionHeader
              title="What Synítheia noticed"
              action="See all"
              onAction={() => router.push('/insights')}
            />
            <InsightCard insight={data.featuredInsight} currency={currency} />
          </View>
        ) : (
          <View style={styles.section}>
            <Touchable
              onPress={() => router.push('/insights')}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Open Synítheia AI insights"
              style={styles.insightsLink}
            >
              <Sparkles size={18} color={palette.sage} strokeWidth={1.7} />
              <Text variant="bodyMedium" color={palette.stoneMuted} style={{ flex: 1 }}>
                What Synítheia noticed
              </Text>
              <ChevronRight size={18} color={palette.stoneFaint} strokeWidth={1.7} />
            </Touchable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * "Why am I seeing this?" renders the stored metrics the model was actually given —
 * never a second model call. The explanation must BE the evidence, not a plausible
 * reconstruction of it. See insight.ts.
 */
function InsightCard({
  insight,
  currency,
}: {
  insight: NonNullable<TodayResponse['featuredInsight']>;
  currency: string;
}) {
  const [explained, setExplained] = useState(false);

  return (
    <Card style={styles.insight}>
      <Text variant="cardTitle">{insight.title}</Text>
      <Text variant="body" color={palette.stoneMuted}>
        {insight.description}
      </Text>

      <Touchable
        accessibilityRole="button"
        accessibilityLabel="Why am I seeing this?"
        accessibilityState={{ expanded: explained }}
        haptic={false}
        onPress={() => setExplained((open) => !open)}
        style={styles.whyRow}
      >
        <Info size={14} color={palette.stoneFaint} strokeWidth={1.8} />
        <Text variant="label" color={palette.stoneMuted}>
          Why am I seeing this?
        </Text>
      </Touchable>

      {explained ? (
        <View style={styles.evidence} accessibilityLiveRegion="polite">
          <Text variant="caption" color={palette.stoneMuted}>
            {insight.evidenceSummary}
          </Text>

          {insight.supportingMetrics.map((metric) => (
            <View key={metric.key} style={styles.metricRow}>
              <Text variant="caption" color={palette.stoneFaint} style={styles.metricLabel}>
                {metric.label}
              </Text>
              <Text variant="caption" color={palette.stone}>
                {formatMetric(metric, currency)}
                {metric.comparisonValue !== null && metric.comparisonLabel !== null
                  ? ` vs ${formatMetric(
                      { ...metric, value: metric.comparisonValue },
                      currency,
                    )} ${metric.comparisonLabel}`
                  : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const AVATAR = 44;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  avatarTarget: {
    minWidth: MIN_TAP_TARGET,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.full,
    backgroundColor: palette.sand,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.sage,
  },
  iconButton: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  greeting: { marginTop: spacing.xs },
  subtitle: { marginTop: spacing.xs },
  ring: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  chips: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
  },
  section: { marginTop: spacing['2xl'] },
  insightsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.surfaceDim,
  },
  habits: { gap: spacing.base },
  suggestions: {
    marginTop: spacing['2xl'],
    gap: spacing.base,
  },
  suggestion: { gap: spacing.sm },
  tagRow: { flexDirection: 'row' },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: palette.sand,
    borderWidth: 1,
    borderColor: palette.surfaceDim,
  },
  suggestionActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  suggestionButton: { minWidth: 120 },
  insight: {
    marginTop: spacing['2xl'],
    gap: spacing.sm,
  },
  whyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TAP_TARGET,
  },
  evidence: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.surfaceDim,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  metricLabel: { flexShrink: 1 },
});
