import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBackOrHome } from '../src/navigation/goBackOrHome.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react-native';
import {
  currencyMeta,
  parseMoneyInput,
  type TargetsView,
  type TrackedDomain,
  type UpdateTargetsInput,
} from '@synitheia/shared';
import { Button, Card, ErrorState, Input, Text, Touchable } from '../src/components/primitives.js';
import { SkeletonScreen } from '../src/components/Skeleton.js';
import { api } from '../src/api/client.js';
import { errorLine } from '../src/api/errorCopy.js';
import { budgetInputValue } from '../src/expenses/budgetInput.js';
import { ScreenHeader } from '../src/components/ScreenHeader.js';
import { screen, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import type { Theme } from '../src/theme/theme.js';

/**
 * The Targets screen: what you track, and the number each tracked area is measured against.
 *
 * Setup asks what to track and promises "You can change this later"; this is where. Each
 * area is a row with a switch, and its number appears only while it is on, so a habits-only
 * user is not shown a water goal, but can still turn water on. Before this, the screen
 * showed only the numbers of tracked areas, which left a habits-only user an empty card.
 */

const AREAS: { domain: TrackedDomain; label: string; blurb: string }[] = [
  { domain: 'habits', label: 'Habits', blurb: 'Daily habits and streaks' },
  { domain: 'expenses', label: 'Money', blurb: 'Spending, bills, splits' },
  { domain: 'nutrition', label: 'Food', blurb: 'Meals and calories' },
  { domain: 'water', label: 'Water', blurb: 'Daily hydration' },
];

function TargetsForm({ initial }: { initial: TargetsView }) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const [tracked, setTracked] = useState<TrackedDomain[]>(initial.trackedDomains);
  const tracks = (d: TrackedDomain): boolean => tracked.includes(d);
  const toggle = (d: TrackedDomain, on: boolean) =>
    setTracked((now) =>
      on
        ? AREAS.map((a) => a.domain).filter((x) => x === d || now.includes(x))
        : now.filter((x) => x !== d),
    );

  const [water, setWater] = useState(String(initial.waterTargetMl));
  const [calories, setCalories] = useState(String(initial.calorieTarget));
  const [budget, setBudget] = useState(budgetInputValue(initial.monthlyBudgetMinor, initial.currency));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    meta: { reportsOwnError: true },
    mutationFn: () => {
      const body: UpdateTargetsInput = { trackedDomains: tracked };
      if (tracks('water')) body.waterTargetMl = Number(water) || initial.waterTargetMl;
      if (tracks('nutrition')) body.calorieTarget = Number(calories) || initial.calorieTarget;
      if (tracks('expenses')) {
        // Blank means "no budget", not zero — the two are different, and the server stores null.
        body.monthlyBudgetMinor =
          budget.trim() === '' ? null : (parseMoneyInput(budget, initial.currency) ?? null);
      }
      return api.patch<unknown>('/me/targets', body);
    },
    onSuccess: () => {
      // Today reads these numbers for the ring and the budget line; refresh both, then leave.
      void queryClient.invalidateQueries({ queryKey: ['targets'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      // The month view scores each day against the same tracked areas.
      void queryClient.invalidateQueries({ queryKey: ['month'] });
      goBackOrHome(router);
    },
    onError: (err: unknown) => {
      setError(errorLine(err, 'Couldn’t save your targets'));
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader
        title="Targets"
        subtitle="What you track, and the numbers your day is measured against. Change them whenever they stop fitting."
      />

      {AREAS.map(({ domain, label, blurb }) => {
        const on = tracks(domain);
        const onlyOne = on && tracked.length === 1;
        return (
          <Card key={domain} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowCopy}>
                <Text variant="cardTitle">{label}</Text>
                <Text variant="caption" color={t.textMuted}>
                  {onlyOne ? 'Keep at least one area on' : blurb}
                </Text>
              </View>
              <Switch
                value={on}
                disabled={onlyOne}
                onValueChange={(next) => toggle(domain, next)}
                trackColor={{ true: t.accent, false: t.border }}
                accessibilityLabel={`Track ${label.toLowerCase()}`}
              />
            </View>

            {on && domain === 'habits' ? (
              <Touchable
                style={styles.link}
                accessibilityRole="button"
                onPress={() => router.push('/habits')}
              >
                <Text variant="body" color={t.accent}>
                  Each habit has its own goal. Edit your habits
                </Text>
                <ChevronRight size={18} color={t.accent} strokeWidth={1.8} />
              </Touchable>
            ) : null}

            {on && domain === 'expenses' ? (
              <Input
                label="Monthly budget (optional)"
                value={budget}
                onChangeText={setBudget}
                keyboardType="decimal-pad"
                placeholder="Leave blank for none"
                accessibilityLabel="Monthly budget"
                leading={
                  <Text variant="bodyMedium" color={t.textFaint}>
                    {currencyMeta(initial.currency).symbol}
                  </Text>
                }
              />
            ) : null}

            {on && domain === 'nutrition' ? (
              <Input
                label="Calories each day"
                value={calories}
                onChangeText={setCalories}
                keyboardType="number-pad"
                accessibilityLabel="Daily calorie target"
              />
            ) : null}

            {on && domain === 'water' ? (
              <Input
                label="Water each day (ml)"
                value={water}
                onChangeText={setWater}
                keyboardType="number-pad"
                accessibilityLabel="Daily water target in millilitres"
              />
            ) : null}
          </Card>
        );
      })}

      {error ? (
        <Text variant="caption" color={t.danger} style={{ marginTop: spacing.md }}>
          {error}
        </Text>
      ) : null}

      <Button
        label="Save"
        loading={save.isPending}
        onPress={() => save.mutate()}
        style={styles.cta}
      />
    </ScrollView>
  );
}

export default function Targets() {
  const styles = useThemedStyles(makeStyles);
  const query = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<TargetsView>('/me/targets'),
  });

  if (query.isPending) {
    return <SkeletonScreen rows={3} showLeading={false} header={<ScreenHeader title="Targets" />} />;
  }

  if (query.error || !query.data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          <ScreenHeader title="Targets" />
          <ErrorState
            error={query.error}
            message="Could not load your targets."
            onRetry={() => void query.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {/* Keyed on the loaded values so the fields initialise from them exactly once. */}
        <TargetsForm key={query.dataUpdatedAt} initial={query.data} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    content: {
      paddingHorizontal: screen.gutter,
      paddingTop: screen.top,
      paddingBottom: spacing['4xl'],
    },
    card: { gap: spacing.base, marginBottom: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rowCopy: { flex: 1, gap: 2 },
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    cta: { marginTop: spacing.md },
  });
