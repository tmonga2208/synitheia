import { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '../../src/navigation/goBackOrHome.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Flame, Trophy, Zap } from 'lucide-react-native';
import {
  formatHabitProgress,
  formatHabitTarget,
  measureOf,
  type TodayResponse,
} from '@synitheia/shared';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { SkeletonList } from '../../src/components/Skeleton.js';
import { ProgressRing } from '../../src/components/ProgressRing.js';
import { iconFor } from '../../src/components/IconPicker.js';
import { api } from '../../src/api/client.js';
import { describeError } from '../../src/api/errorCopy.js';
import type { HabitHistory, ListResponse, WireHabit } from '../../src/api/types.js';
import { MIN_TAP_TARGET, radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../../src/theme/theme.js';

const HABITS_KEY = ['habits'] as const;
const TODAY_KEY = ['today'] as const;

export default function HabitDetail() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const habitsQuery = useQuery({
    queryKey: HABITS_KEY,
    queryFn: () => api.get<ListResponse<WireHabit>>('/habits'),
  });

  const todayQuery = useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => api.get<TodayResponse>('/today'),
  });

  const historyQuery = useQuery({
    queryKey: ['habit-history', id],
    queryFn: () => api.get<HabitHistory>(`/habits/${id}/history?days=30`),
  });

  const habit = useMemo(
    () => habitsQuery.data?.items.find((h) => h._id === id),
    [habitsQuery.data, id],
  );

  const progress = useMemo(
    () => todayQuery.data?.habits.find((h) => h.id === id),
    [todayQuery.data, id],
  );

  /**
   * Archive, not delete. The server soft-archives, because a habit's logs ARE the
   * user's history and deleting the habit must not erase the fact that they meditated
   * every morning for six weeks.
   */
  const archive = useMutation({
    meta: { reportsOwnError: true },
    mutationFn: () => api.delete<void>(`/habits/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HABITS_KEY });
      void queryClient.invalidateQueries({ queryKey: TODAY_KEY });
      goBackOrHome(router);
    },
    onError: (error: unknown) => {
      Alert.alert('Couldn’t archive this habit', describeError(error).message);
    },
  });

  function confirmArchive() {
    if (!habit) return;

    Alert.alert(
      `Archive ${habit.name}?`,
      'It leaves your daily list. Your logs and streaks are kept — nothing is deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', style: 'destructive', onPress: () => archive.mutate() },
      ],
    );
  }

  const back = (
    <Touchable
      style={styles.iconButton}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      haptic={false}
      onPress={() => goBackOrHome(router)}
    >
      <ArrowLeft size={22} color={t.textPrimary} />
    </Touchable>
  );

  if (habitsQuery.isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <SkeletonList />
      </SafeAreaView>
    );
  }

  if (habitsQuery.error || !habit) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          <ErrorState
            error={habitsQuery.error}
            message="This habit no longer exists."
            onRetry={() => void habitsQuery.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const accent = accentFor(habit.color, t);
  const { Icon } = iconFor(habit.icon);

  const todayCount = progress?.todayCount ?? 0;

  /**
   * Today's completion, not an all-time rate.
   *
   * The API exposes no per-habit log history, and deriving a "completion rate" from the
   * streak (streak ÷ days since created) would quietly slander the user: a habit kept
   * five days out of seven has a streak of one and would render as 14%. Showing the one
   * number we can actually stand behind — and saying which number it is — beats showing
   * a confident wrong one.
   */
  const history = historyQuery.data;

  /**
   * The 30-day success rate, scored only against the periods the habit actually existed
   * for — a habit created last Tuesday is not judged on the whole month. Falls back to
   * today's progress while the history loads, rather than flashing a misleading 0%.
   */
  const percent = history
    ? Math.round(history.completionRate * 100)
    : habit.targetCount > 0
      ? Math.min(100, (todayCount / habit.targetCount) * 100)
      : 0;

  const period = habit.frequency === 'daily' ? 'Daily' : 'Weekly';
  const goal =
    measureOf(habit) === 'check'
      ? period
      : `${formatHabitTarget(habit)} ${period.toLowerCase()}`;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {back}
          <View style={[styles.iconChip, { backgroundColor: accent.wash }]}>
            <Icon size={22} color={accent.text} strokeWidth={1.5} />
          </View>
        </View>

        <Text variant="overline" color={accent.text}>
          {habit.category ?? period}
        </Text>
        <Text variant="title" style={styles.name}>
          {habit.name}
        </Text>
        <Text variant="body" color={t.textMuted} style={styles.goal}>
          {`Goal: ${goal}`}
        </Text>

        <View style={styles.ring}>
          <ProgressRing percent={percent} color={accent.base} />
          <Text variant="label" color={t.textFaint} style={styles.ringCaption}>
            {history
              ? `${history.completedPeriods} of ${history.scheduledPeriods} ${
                  habit.frequency === 'daily' ? 'days' : 'weeks'
                }`
              : `Today · ${formatHabitProgress(habit, todayCount) || `${todayCount} of ${habit.targetCount}`}`}
          </Text>
        </View>

        <View style={styles.chips}>
          <Chip
            label={
              habit.currentStreak > 0
                ? `${habit.currentStreak} Day Streak`
                : 'No streak yet'
            }
            icon={<Flame size={14} color={accent.text} strokeWidth={2} />}
            accent={accent.base}
            accessibilityRole="text"
            haptic={false}
          />
          <Chip
            label={`Longest: ${habit.longestStreak}`}
            icon={<Trophy size={14} color={accent.text} strokeWidth={2} />}
            accent={accent.base}
            accessibilityRole="text"
            haptic={false}
          />
        </View>

        {habit.reminderTime ? (
          <Card style={styles.reminderCard}>
            <Zap size={18} color={t.textMuted} strokeWidth={1.6} />
            <Text variant="body" color={t.textMuted}>
              {`Gentle reminder at ${habit.reminderTime}`}
            </Text>
          </Card>
        ) : null}

        <Card style={styles.archiveCard}>
          <View style={styles.archiveCopy}>
            <Archive size={18} color={t.textMuted} strokeWidth={1.6} />
            <Text variant="cardTitle">Archive this habit</Text>
          </View>
          <Text variant="body" color={t.textMuted}>
            It leaves your daily list, but every log you have made stays in your history.
          </Text>

          <Button
            label="Archive"
            variant="secondary"
            loading={archive.isPending}
            onPress={confirmArchive}
            haptic={false}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing['4xl'],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      marginBottom: spacing.base,
    },
    iconButton: {
      width: MIN_TAP_TARGET,
      height: MIN_TAP_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
    },
    iconChip: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: { marginTop: spacing.xs },
    goal: { marginTop: spacing.xs },
    ring: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.md },
    ringCaption: { marginTop: spacing.sm },
    chips: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.md,
      marginTop: spacing.xl,
    },
    reminderCard: {
      marginTop: spacing.xl,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    archiveCard: { marginTop: spacing.xl, gap: spacing.md },
    archiveCopy: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
  });
