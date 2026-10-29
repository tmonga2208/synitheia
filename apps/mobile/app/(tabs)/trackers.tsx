import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Droplets, Leaf, Utensils, Wallet } from 'lucide-react-native';
import {
  WATER_PRESETS_ML,
  asMinor,
  formatMoney,
  formatMoneyCompact,
  type TodayResponse,
  formatVolume,
} from '@synitheia/shared';
import {
  Card,
  Chip,
  ErrorState,
  SectionHeader,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { SkeletonTrackers } from '../../src/components/Skeleton.js';
import { TrackerTile } from '../../src/components/TrackerTile.js';
import { WeekStrip, type WeekStripDay } from '../../src/components/WeekStrip.js';
import { summarizeWeek, weekOf } from '../../src/today/week.js';
import { api } from '../../src/api/client.js';
import { useAddWater } from '../../src/water/useAddWater.js';
import { useAuth } from '../../src/store/auth.js';
import { TAB_BAR_CLEARANCE, radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../../src/theme/theme.js';

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

export default function Trackers() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  /**
   * Colour is domain identity here, drawn from the habit accent palette — the per-item
   * tinting that is already the most distinctive thing in this design language.
   */
  const ACCENTS = {
    expenses: accentFor('#C08A7D', t), // clay
    water: accentFor('#8A9AA9', t), // slate — the closest this palette comes to water
    nutrition: accentFor('#B0917D', t), // sand
    habits: accentFor('#7D927D', t), // sage, the signature
  } as const;

  const user = useAuth((s) => s.user);
  const currency = user?.currency ?? 'INR';

  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => api.get<TodayResponse>('/today'),
  });

  /**
   * A glass shows at once, here and on the water screen, with or without a connection
   * (src/water/useAddWater.ts). Each tap is its own glass; a resend of the same glass, after
   * a lost answer, is recognised by the server and logged once.
   */
  const addWater = useAddWater();

  if (isPending) return <SkeletonTrackers />;

  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          <ErrorState
            error={error}
            message="Could not load your trackers."
            onRetry={() => void refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const habitsDone = data.habits.filter((h) => h.todayComplete).length;
  const budget = data.expenses.budgetRemainingMinor;
  const spent = data.expenses.totalMinor;

  // Each row of "This week" is the same seven days, read for one tracker. Today's value
  // is the live one, so a glass just logged shows here too.
  const waterWeek = weekOf(data, (d) => d.waterMl, data.water.totalMl);
  const foodWeek = weekOf(data, (d) => d.calories, data.nutrition.totals.calories);
  const spentWeek = weekOf(data, (d) => d.spentMinor, spent);
  const habitWeek = weekOf(
    data,
    (d) => (d.habitsScheduled > 0 ? (d.habitsDone / d.habitsScheduled) * 100 : 0),
    data.habits.length > 0 ? (habitsDone / data.habits.length) * 100 : 0,
  );
  const habitTotals = data.weeklyFlow.reduce(
    (acc, d) =>
      d.isToday
        ? { done: acc.done + habitsDone, of: acc.of + data.habits.length }
        : {
            done: acc.done + (d.totals?.habitsDone ?? 0),
            of: acc.of + (d.totals?.habitsScheduled ?? 0),
          },
    { done: 0, of: 0 },
  );

  const weekRows: {
    key: string;
    label: string;
    figure: string;
    days: WeekStripDay[] | null;
    target: number | null;
    color: string;
    labelColor: string;
    describe: (v: number) => string;
    href: '/expenses' | '/water' | '/nutrition' | '/habits';
  }[] = [
    {
      key: 'expenses',
      label: 'Spent in 7 days',
      figure: formatMoneyCompact(
        asMinor((spentWeek ?? []).reduce((sum, d) => sum + d.value, 0)),
        currency,
      ),
      days: spentWeek,
      target: null,
      color: ACCENTS.expenses.base,
      labelColor: ACCENTS.expenses.text,
      describe: (v) => formatMoney(asMinor(v), currency),
      href: '/expenses',
    },
    {
      key: 'water',
      label: 'Water a day',
      figure: (() => {
        const usual = waterWeek ? summarizeWeek(waterWeek).usual : null;
        return usual != null ? formatVolume(Math.round(usual / 100) * 100) : '—';
      })(),
      days: waterWeek,
      target: data.water.targetMl,
      color: ACCENTS.water.base,
      labelColor: ACCENTS.water.text,
      describe: (v) => formatVolume(v),
      href: '/water',
    },
    {
      key: 'nutrition',
      label: 'Calories a day',
      figure: (() => {
        const usual = foodWeek ? summarizeWeek(foodWeek).usual : null;
        return usual != null ? Math.round(usual).toLocaleString() : '—';
      })(),
      days: foodWeek,
      target: null,
      color: ACCENTS.nutrition.base,
      labelColor: ACCENTS.nutrition.text,
      describe: (v) => `${Math.round(v)} kilocalories`,
      href: '/nutrition',
    },
    {
      key: 'habits',
      label: 'Habits done',
      figure: habitTotals.of > 0 ? `${habitTotals.done} of ${habitTotals.of}` : '—',
      days: habitWeek,
      target: 100,
      color: ACCENTS.habits.base,
      labelColor: ACCENTS.habits.text,
      describe: (v) => `${Math.round(v)} percent of habits`,
      href: '/habits',
    },
  ];

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
        <Text variant="overline" color={t.textMuted}>
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
                data.expenses.count === 1
                  ? '1 expense today'
                  : `${data.expenses.count} expenses today`
              }
              /**
               * Spending shows progress only against a budget the user actually set.
               * Without one there is nothing to be a fraction of, and drawing an empty
               * rail would invent a goal they never chose — the same reason the Daily
               * Flow ring counts only the trackers you use.
               */
              progress={
                budget !== null && spent + budget > 0 ? spent / (spent + budget) : null
              }
              onPress={() => router.push('/expenses')}
            />

            <TrackerTile
              label="Water"
              icon={<Droplets size={20} color={ACCENTS.water.text} strokeWidth={1.7} />}
              accent={ACCENTS.water}
              value={formatVolume(data.water.totalMl)}
              caption={`of ${formatVolume(data.water.targetMl)}`}
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
              value={Math.round(data.nutrition.totals.calories).toLocaleString()}
              caption={`of ${data.nutrition.calorieTarget.toLocaleString()} kcal`}
              progress={data.nutrition.totals.calories / data.nutrition.calorieTarget}
              onPress={() => router.push('/nutrition')}
            />

            <TrackerTile
              label="Habits"
              icon={<Leaf size={20} color={ACCENTS.habits.text} strokeWidth={1.7} />}
              accent={ACCENTS.habits}
              value={
                data.habits.length > 0
                  ? `${habitsDone} of ${data.habits.length}`
                  : 'None yet'
              }
              caption={data.habits.length > 0 ? 'done today' : 'Tap to add one'}
              progress={data.habits.length > 0 ? habitsDone / data.habits.length : null}
              onPress={() => router.push('/habits')}
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
              onPress={() => addWater(ml)}
              accessibilityRole="button"
              accessibilityLabel={`Log ${ml} millilitres of water`}
            >
              <Text variant="bodyMedium" color={ACCENTS.water.text}>
                +{ml}
              </Text>
              <Text variant="caption" color={t.textFaint}>
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

        {waterWeek ? (
          <>
            <View style={styles.weekHeader}>
              <SectionHeader title="Last 7 days" />
            </View>
            <Card padded={false}>
              {weekRows.map((row, index) =>
                row.days ? (
                  <Touchable
                    key={row.key}
                    style={[styles.weekRow, index > 0 && styles.divider]}
                    haptic={false}
                    onPress={() => router.push(row.href)}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.label}, ${row.figure}. Opens ${row.key}.`}
                  >
                    <View style={styles.weekCopy}>
                      <Text variant="caption" color={row.labelColor}>
                        {row.label}
                      </Text>
                      <Text variant="bodyMedium">{row.figure}</Text>
                    </View>
                    <View style={styles.weekBars}>
                      <WeekStrip
                        compact
                        days={row.days}
                        target={row.target}
                        color={row.color}
                        format={() => ''}
                        describe={row.describe}
                      />
                    </View>
                  </Touchable>
                ) : null,
              )}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: spacing.lg, paddingBottom: TAB_BAR_CLEARANCE },
    title: { marginTop: spacing.xs, marginBottom: spacing.xl },

    grid: { gap: spacing.md, marginBottom: spacing['2xl'] },
    row: { flexDirection: 'row', gap: spacing.md },

    presets: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.base },
    preset: {
      flex: 1,
      minHeight: 56,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },

    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

    weekHeader: { marginTop: spacing['2xl'] },
    weekRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.base,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    weekCopy: { width: 116, gap: 2 },
    weekBars: { flex: 1 },
  });
