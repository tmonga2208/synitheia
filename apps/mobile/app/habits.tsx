import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBackOrHome } from '../src/navigation/goBackOrHome.js';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Leaf, Plus } from 'lucide-react-native';
import type { TodayResponse } from '@synitheia/shared';
import {
  EmptyState,
  ErrorState,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { SkeletonList } from '../src/components/Skeleton.js';
import { HabitCard, type TodayHabit } from '../src/components/HabitCard.js';
import { api } from '../src/api/client.js';
import type { ListResponse, WireHabit } from '../src/api/types.js';
import { useHabitLog } from '../src/habits/useHabitLog.js';
import { LogAmountSheet } from '../src/habits/LogAmountSheet.js';
import { MIN_TAP_TARGET, radius, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import type { Theme } from '../src/theme/theme.js';

const HABITS_KEY = ['habits'] as const;
const TODAY_KEY = ['today'] as const;

/**
 * /habits is the list of habits that exist; /today is what has happened to them today.
 * The card needs both, so they are merged here rather than asking the server for a
 * third, near-duplicate endpoint. Today is already cached from the home screen, so in
 * practice this costs one request.
 */
function merge(habits: WireHabit[], today: TodayResponse | undefined): TodayHabit[] {
  const progress = new Map(today?.habits.map((h) => [h.id, h]) ?? []);

  return habits.map((habit) => {
    const logged = progress.get(habit._id);

    return {
      ...habit,
      id: habit._id,
      createdAt: new Date(habit.createdAt),
      updatedAt: new Date(habit.updatedAt),
      archivedAt: habit.archivedAt ? new Date(habit.archivedAt) : null,
      todayCount: logged?.todayCount ?? 0,
      todayComplete: logged?.todayComplete ?? false,
    };
  });
}

export default function Habits() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  const habitsQuery = useQuery({
    queryKey: HABITS_KEY,
    queryFn: () => api.get<ListResponse<WireHabit>>('/habits'),
  });

  const todayQuery = useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => api.get<TodayResponse>('/today'),
  });

  // The same ticking as Today: optimistic, with Undo, and a tap on a ticked habit steps back.
  const habitLog = useHabitLog();
  const [adjusting, setAdjusting] = useState<TodayHabit | null>(null);

  const openHabit = useCallback((habit: TodayHabit) => {
    router.push(`/habit/${habit.id}`);
  }, []);

  const habits = useMemo(
    () => merge(habitsQuery.data?.items ?? [], todayQuery.data),
    [habitsQuery.data, todayQuery.data],
  );

  const back = (
    <Touchable
      onPress={() => goBackOrHome(router)}
      style={styles.back}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <ArrowLeft size={22} color={t.textPrimary} strokeWidth={1.8} />
    </Touchable>
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text variant="overline" color={t.textFaint}>
          Your habits
        </Text>
        <Text variant="title">Habits</Text>
      </View>

      <Touchable
        accessibilityRole="button"
        accessibilityLabel="Add a new habit"
        onPress={() => router.push('/habit/new')}
        style={styles.add}
      >
        <Plus size={22} color={t.onAccent} strokeWidth={2} />
      </Touchable>
    </View>
  );

  if (habitsQuery.isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <SkeletonList />
      </SafeAreaView>
    );
  }

  if (habitsQuery.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          {header}
          <ErrorState
            error={habitsQuery.error}
            message="We could not load your habits."
            onRetry={() => void habitsQuery.refetch()}
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
            refreshing={habitsQuery.isRefetching}
            onRefresh={() => void habitsQuery.refetch()}
            tintColor={t.accent}
          />
        }
      >
        {back}
        {header}

        {habits.length === 0 ? (
          <EmptyState
            icon={<Leaf size={30} color={t.onAccent} strokeWidth={1.5} />}
            title="No habits yet"
            body="Add one small thing you want to do each day, then tick it off here."
            actionLabel="+ Add a habit"
            onAction={() => router.push('/habit/new')}
          />
        ) : (
          <View style={styles.list}>
            {habits.map((habit) => (
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
      </ScrollView>

      <LogAmountSheet habit={adjusting} onClose={() => setAdjusting(null)} onSave={habitLog.setCount} />
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xl,
    },
    back: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing.md,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      marginBottom: spacing.lg,
    },
    headerCopy: { gap: spacing.xs },
    add: {
      width: MIN_TAP_TARGET + 4,
      height: MIN_TAP_TARGET + 4,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accent,
    },
    list: { gap: spacing.base },
  });
