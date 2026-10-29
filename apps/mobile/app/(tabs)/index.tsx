import { useCallback, useMemo, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Info,
  Leaf,
  Sparkles,
  Zap,
} from 'lucide-react-native';
import {
  asMinor,
  formatDayLabel,
  formatMoney,
  type SupportingMetric,
  type TodayResponse,
  formatVolume,
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
import { dayLine } from '../../src/today/dayLine.js';
import { useSplashDone } from '../../src/components/splashState.js';
import { HabitCard, type TodayHabit } from '../../src/components/HabitCard.js';
import { WeeklyChart } from '../../src/components/WeeklyChart.js';
import { Timeline } from '../../src/components/Timeline.js';
import { api, isQueued } from '../../src/api/client.js';
import { useCalendarSync } from '../../src/calendar/useCalendarSync.js';
import { useHabitLog } from '../../src/habits/useHabitLog.js';
import { LogAmountSheet } from '../../src/habits/LogAmountSheet.js';
import { useSourcePrefsMirror } from '../../src/sync/useSourcePrefsMirror.js';
import { useHealthSync } from '../../src/health/useHealthSync.js';
import { useAuth } from '../../src/store/auth.js';
import { MIN_TAP_TARGET, TAB_BAR_CLEARANCE, radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import type { Theme } from '../../src/theme/theme.js';

const TODAY_KEY = ['today'] as const;

interface SuggestionAnswer {
  id: string;
  action: 'confirm' | 'reject';
  /** Names the answer if the server refuses it when it syncs. */
  title: string;
}

function formatMetric(metric: SupportingMetric, currency: string): string {
  switch (metric.unit) {
    case 'minor_currency':
      return formatMoney(asMinor(Math.round(metric.value)), currency);
    case 'ml':
      return formatVolume(metric.value);
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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  /**
   * The phone's health store, pulled on every foreground.
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

  useSourcePrefsMirror(healthSources.data?.items);

  const calendarConnected =
    healthSources.data?.items.some((s) => s.source === 'calendar' && s.status === 'connected') ??
    false;

  useHealthSync(healthConnected);
  // The same runner the background task uses. A connected calendar had no reason to be
  // stale in the foreground; it was only ever read when the source was switched on.
  useCalendarSync(calendarConnected);

  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => api.get<TodayResponse>('/today'),
  });

  // Ticks are optimistic and offer Undo; a tap on a ticked habit takes the step back.
  const habitLog = useHabitLog();
  const [adjusting, setAdjusting] = useState<TodayHabit | null>(null);

  const resolveSuggestion = useMutation({
    meta: { failed: 'Couldn’t save your answer' },
    mutationFn: ({ id, action, title }: SuggestionAnswer) =>
      api.offline.post<unknown>(`/inferences/${id}/resolve`, { action }, title),

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

    // Still on the phone: the card has already gone, and the sync refetches when it lands.
    onSettled: (result) =>
      isQueued(result) ? undefined : queryClient.invalidateQueries({ queryKey: TODAY_KEY }),
  });

  const openHabit = useCallback((habit: TodayHabit) => {
    router.push(`/habit/${habit.id}`);
  }, []);

  const { data, error, isPending, isRefetching, refetch } = query;

  const overline = useMemo(
    () => (data ? formatDayLabel(data.localDate) : ''),
    [data],
  );

  const firstName = user?.name.split(' ')[0] ?? 'there';
  const timezone =
    user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const currency = user?.currency ?? 'INR';
  // The ring fills once the launch splash has gone, so the fill is seen rather than missed.
  const splashDone = useSplashDone();

  if (isPending) return <SkeletonToday />;

  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          <ErrorState
            error={error}
            message="We could not load your day."
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
            tintColor={t.accent}
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
                <Text variant="cardTitle" color={t.onAccent}>
                  {firstName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </Touchable>

          <View style={styles.headerActions}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="History"
              accessibilityHint="Browse past days"
              haptic={false}
              onPress={() => router.push('/history')}
              style={styles.iconButton}
            >
              <CalendarDays size={22} color={t.textPrimary} strokeWidth={1.6} />
            </Touchable>

            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Reminders and notifications"
              haptic={false}
              onPress={() => router.push('/reminders')}
              style={styles.iconButton}
            >
              <Bell size={22} color={t.textPrimary} strokeWidth={1.6} />
            </Touchable>
          </View>
        </View>

        {/* ─── Greeting ────────────────────────────────────────────────────── */}
        <Text variant="overline" color={t.textPrimary}>
          {overline}
        </Text>
        <Text variant="title" style={styles.greeting}>
          {`${data.greeting}, ${firstName}`}
        </Text>
        <Text variant="body" color={t.textFaint} style={styles.subtitle}>
          {dayLine(data, currency)}
        </Text>

        {/* ─── Daily Flow ──────────────────────────────────────────────────── */}
        <View style={styles.ring}>
          <ProgressRing percent={data.dailyFlow.percent} hold={!splashDone} />
        </View>

        <View style={styles.chips}>
          {/* At zero these become an invitation rather than a score of nothing. */}
          <Chip
            label={data.streakDays > 0 ? `${data.streakDays}-day streak` : 'Streaks'}
            icon={<Zap size={14} color={t.textPrimary} strokeWidth={2} />}
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
            onAction={() => router.push('/habits')}
          />

          {data.habits.length === 0 ? (
            <EmptyState
              icon={<Leaf size={30} color={t.onAccent} strokeWidth={1.5} />}
              title="No habits yet"
              body="Add one small thing you want to do each day, then tick it off here."
              actionLabel="+ Add a habit"
              onAction={() => router.push('/habit/new')}
            />
          ) : (
            <View style={styles.habits}>
              {data.habits.map((habit) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  onPress={openHabit}
                  onLog={habitLog.log}
                  onUnlog={habitLog.unlog}
                  onAdjust={setAdjusting}
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
                    <Text variant="caption" color={t.textFaint}>
                      detected
                    </Text>
                  </View>
                </View>

                <Text variant="cardTitle">{suggestion.title}</Text>

                {suggestion.description ? (
                  <Text variant="body" color={t.textMuted}>
                    {suggestion.description}
                  </Text>
                ) : null}

                {/* The evidence, in the user's own terms. A suggestion the user cannot
                    check is a suggestion they can only obey or ignore. */}
                {suggestion.evidence.map((item) => (
                  <Text
                    key={`${suggestion.id}:${item.label}`}
                    variant="caption"
                    color={t.textFaint}
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
                      resolveSuggestion.mutate({
                        id: suggestion.id,
                        action: 'reject',
                        title: suggestion.title,
                      })
                    }
                  />
                  <Button
                    label="Confirm"
                    fullWidth={false}
                    style={styles.suggestionButton}
                    onPress={() =>
                      resolveSuggestion.mutate({
                        id: suggestion.id,
                        action: 'confirm',
                        title: suggestion.title,
                      })
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
              <Sparkles size={18} color={t.accent} strokeWidth={1.7} />
              <Text variant="bodyMedium" color={t.textMuted} style={{ flex: 1 }}>
                What Synítheia noticed
              </Text>
              <ChevronRight size={18} color={t.textFaint} strokeWidth={1.7} />
            </Touchable>
          </View>
        )}
      </ScrollView>

      <LogAmountSheet habit={adjusting} onClose={() => setAdjusting(null)} onSave={habitLog.setCount} />
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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [explained, setExplained] = useState(false);

  return (
    <Card style={styles.insight}>
      <Text variant="cardTitle">{insight.title}</Text>
      <Text variant="body" color={t.textMuted}>
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
        <Info size={14} color={t.textFaint} strokeWidth={1.8} />
        <Text variant="label" color={t.textMuted}>
          Why am I seeing this?
        </Text>
      </Touchable>

      {explained ? (
        <View style={styles.evidence} accessibilityLiveRegion="polite">
          <Text variant="caption" color={t.textMuted}>
            {insight.evidenceSummary}
          </Text>

          {insight.supportingMetrics.map((metric) => (
            <View key={metric.key} style={styles.metricRow}>
              <Text variant="caption" color={t.textFaint} style={styles.metricLabel}>
                {metric.label}
              </Text>
              <Text variant="caption" color={t.textPrimary}>
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

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: {
      paddingHorizontal: spacing.xl,
      paddingBottom: TAB_BAR_CLEARANCE,
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
      backgroundColor: t.surfaceRaised,
    },
    avatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accent,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
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
      borderColor: t.border,
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
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.border,
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
      borderTopColor: t.border,
    },
    metricRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    metricLabel: { flexShrink: 1 },
  });
