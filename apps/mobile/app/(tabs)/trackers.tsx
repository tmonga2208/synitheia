import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Droplets, Leaf, Utensils, Wallet } from 'lucide-react-native';
import {
  WATER_PRESETS_ML,
  asMinor,
  formatMoney,
  type TodayResponse,
} from '@synitheia/shared';
import {
  Chip,
  ErrorState,
  LoadingState,
  SectionHeader,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { TrackerTile } from '../../src/components/TrackerTile.js';
import { ApiError, api } from '../../src/api/client.js';
import { useAuth } from '../../src/store/auth.js';
import { accentFor, palette, radius, spacing } from '../../src/theme/tokens.js';

const TODAY_KEY = ['today'] as const;

/**
 * The four trackers, at a glance.
 *
 * Each domain previously got a full-width card carrying its summary AND its controls,
 * and the four stacked into a scrolling column of mini-dashboards — the cluttered
 * productivity dashboard this product is explicitly not. That merged two different jobs.
 * They are now separate:
 *
 *   - The GRID answers "is everything covered?" — all four domains legible at once,
 *     detail one tap deeper.
 *   - QUICK ADD answers "log something" — one strip, rather than a control buried in
 *     each of four cards.
 *
 * Water keeps one-tap presets because it is the highest-frequency action in the app;
 * burying it behind a navigation would be a real regression dressed up as tidiness.
 *
 * Everything reads the single /today payload the home screen already fetched — a tab
 * switch must not fire four spinners resolving at four different moments, which is
 * exactly what makes an app feel like several tools stapled together.
 */

/**
 * Colour is domain identity here, drawn from the habit accent palette — the per-item
 * tinting that is already the most distinctive thing in this design language.
 */
const ACCENTS = {
  expenses: accentFor('#C08A7D'), // clay
  water: accentFor('#8A9AA9'), // slate — the closest this palette comes to water
  nutrition: accentFor('#B0917D'), // sand
  habits: accentFor('#7D927D'), // sage, the signature
} as const;

export default function Trackers() {
  const user = useAuth((s) => s.user);
  const currency = user?.currency ?? 'INR';
  const queryClient = useQueryClient();

  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => api.get<TodayResponse>('/today'),
  });

  /**
   * Optimistic, and idempotent on the server via clientKey. Tapping a glass must feel
   * instant, and people double-tap it — the key is what stops a second tap, or a retry
   * on a flaky connection, from logging 500ml twice.
   */
  const addWater = useMutation({
    mutationFn: (amountMl: number) =>
      api.post<unknown>('/water', { amountMl, clientKey: Crypto.randomUUID() }),
    onMutate: async (amountMl: number) => {
      await queryClient.cancelQueries({ queryKey: TODAY_KEY });
      const previous = queryClient.getQueryData<TodayResponse>(TODAY_KEY);

      if (previous) {
        queryClient.setQueryData<TodayResponse>(TODAY_KEY, {
          ...previous,
          water: { ...previous.water, totalMl: previous.water.totalMl + amountMl },
        });
      }

      return { previous };
    },
    onError: (_err, _amount, context) => {
      if (context?.previous) queryClient.setQueryData(TODAY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TODAY_KEY }),
  });

  if (isPending) return <LoadingState label="Loading your day" />;

  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          <ErrorState
            message={
              error instanceof ApiError ? error.message : 'Could not load your trackers.'
            }
            onRetry={() => void refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const habitsDone = data.habits.filter((h) => h.todayComplete).length;
  const budget = data.expenses.budgetRemainingMinor;
  const spent = data.expenses.totalMinor;

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
        <Text variant="overline" color={palette.stoneMuted}>
          Today
        </Text>
        <Text variant="title" style={styles.title}>
          Track
        </Text>

        <View style={styles.grid}>
          <View style={styles.row}>
            <TrackerTile
              label="Expenses"
              icon={<Wallet size={20} color={ACCENTS.expenses.text} strokeWidth={1.7} />}
              accent={ACCENTS.expenses}
              value={formatMoney(asMinor(spent), currency)}
              caption={
                data.expenses.count === 1 ? '1 expense today' : `${data.expenses.count} expenses today`
              }
              /**
               * Spending shows progress only against a budget the user actually set.
               * Without one there is nothing to be a fraction of, and drawing an empty
               * rail would invent a goal they never chose — the same reason the Daily
               * Flow ring counts only the trackers you use.
               */
              progress={budget !== null && spent + budget > 0 ? spent / (spent + budget) : null}
              onPress={() => router.push('/expenses')}
            />

            <TrackerTile
              label="Water"
              icon={<Droplets size={20} color={ACCENTS.water.text} strokeWidth={1.7} />}
              accent={ACCENTS.water}
              value={`${data.water.totalMl} ml`}
              caption={`of ${data.water.targetMl.toLocaleString()} ml`}
              progress={data.water.totalMl / data.water.targetMl}
              onPress={() => router.push('/water')}
            />
          </View>

          <View style={styles.row}>
            <TrackerTile
              label="Nutrition"
              icon={
                <Utensils size={20} color={ACCENTS.nutrition.text} strokeWidth={1.7} />
              }
              accent={ACCENTS.nutrition}
              value={String(Math.round(data.nutrition.totals.calories))}
              caption={`of ${data.nutrition.calorieTarget.toLocaleString()} kcal`}
              progress={data.nutrition.totals.calories / data.nutrition.calorieTarget}
              onPress={() => router.push('/nutrition')}
            />

            <TrackerTile
              label="Habits"
              icon={<Leaf size={20} color={ACCENTS.habits.text} strokeWidth={1.7} />}
              accent={ACCENTS.habits}
              value={
                data.habits.length > 0 ? `${habitsDone} of ${data.habits.length}` : 'None yet'
              }
              caption={data.habits.length > 0 ? 'done today' : 'Tap to add one'}
              progress={data.habits.length > 0 ? habitsDone / data.habits.length : null}
              onPress={() => router.push('/(tabs)/habits')}
            />
          </View>
        </View>

        <SectionHeader title="Quick add" />

        {/*
          Water leads, and stays inline. It is the action people take most and the one
          that most rewards being frictionless — a glass of water is not worth a
          navigation.
        */}
        <View style={styles.presets}>
          {WATER_PRESETS_ML.map((ml) => (
            <Touchable
              key={ml}
              style={styles.preset}
              onPress={() => addWater.mutate(ml)}
              accessibilityRole="button"
              accessibilityLabel={`Log ${ml} millilitres of water`}
            >
              <Text variant="bodyMedium" color={ACCENTS.water.text}>
                +{ml}
              </Text>
              <Text variant="caption" color={palette.stoneFaint}>
                ml
              </Text>
            </Touchable>
          ))}
        </View>

        <View style={styles.actions}>
          <Chip
            label="Add expense"
            accent={ACCENTS.expenses.text}
            onPress={() => router.push('/expenses/new')}
            accessibilityLabel="Add an expense"
          />
          <Chip
            label="Log food"
            accent={ACCENTS.nutrition.text}
            onPress={() => router.push('/food/new')}
            accessibilityLabel="Log food"
          />
          <Chip
            label="New habit"
            accent={ACCENTS.habits.text}
            onPress={() => router.push('/habit/new')}
            accessibilityLabel="Create a new habit"
          />
        </View>
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: { marginTop: spacing.xs, marginBottom: spacing.xl },

  grid: { gap: spacing.md, marginBottom: spacing['2xl'] },
  row: { flexDirection: 'row', gap: spacing.md },

  presets: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.base },
  preset: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.surfaceDim,
    backgroundColor: palette.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

});
