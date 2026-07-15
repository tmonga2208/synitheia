import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import {
  currencyMeta,
  parseMoneyInput,
  type TargetsView,
  type TrackedDomain,
  type UpdateTargetsInput,
} from '@synitheia/shared';
import {
  Button,
  Card,
  ErrorState,
  Input,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { SkeletonScreen } from '../src/components/Skeleton.js';
import { ApiError, api } from '../src/api/client.js';
import { palette, spacing } from '../src/theme/tokens.js';

/**
 * The Targets screen — water, calories, and the monthly budget, editable on their own.
 *
 * This used to point at /setup, which is the onboarding wizard: the guard that keeps
 * onboarded users out of onboarding bounced them straight to Today, so the numbers were
 * frozen at whatever they picked on day one. This is a small standalone editor instead, and
 * it only shows the fields for the domains the user actually tracks — a habits-only user has
 * no water goal to edit, and offering one would be noise.
 */

function minorToInput(minor: number | null, currency: string): string {
  if (minor == null) return '';
  const { decimals } = currencyMeta(currency);
  return (minor / 10 ** decimals).toFixed(decimals);
}

function TargetsForm({ initial }: { initial: TargetsView }) {
  const queryClient = useQueryClient();
  const tracks = (d: TrackedDomain): boolean => initial.trackedDomains.includes(d);

  const [water, setWater] = useState(String(initial.waterTargetMl));
  const [calories, setCalories] = useState(String(initial.calorieTarget));
  const [budget, setBudget] = useState(
    minorToInput(initial.monthlyBudgetMinor, initial.currency),
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body: UpdateTargetsInput = {};
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
      router.back();
    },
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not save your targets.',
      );
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Touchable
        onPress={() => router.back()}
        style={styles.back}
        haptic={false}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <ArrowLeft size={22} color={palette.stone} strokeWidth={1.8} />
      </Touchable>

      <Text variant="title" style={styles.title}>
        Targets
      </Text>
      <Text variant="body" color={palette.stoneMuted} style={styles.sub}>
        The numbers your day is measured against. Change them whenever they stop fitting.
      </Text>

      <Card style={styles.card}>
        {tracks('water') ? (
          <Input
            label="Water each day (ml)"
            value={water}
            onChangeText={setWater}
            keyboardType="number-pad"
            accessibilityLabel="Daily water target in millilitres"
          />
        ) : null}

        {tracks('nutrition') ? (
          <Input
            label="Calories each day"
            value={calories}
            onChangeText={setCalories}
            keyboardType="number-pad"
            accessibilityLabel="Daily calorie target"
          />
        ) : null}

        {tracks('expenses') ? (
          <Input
            label="Monthly budget (optional)"
            value={budget}
            onChangeText={setBudget}
            keyboardType="decimal-pad"
            placeholder="Leave blank for none"
            accessibilityLabel="Monthly budget"
          />
        ) : null}
      </Card>

      {error ? (
        <Text variant="caption" color={palette.danger} style={{ marginTop: spacing.md }}>
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
  const query = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<TargetsView>('/me/targets'),
  });

  if (query.isPending) return <SkeletonScreen rows={3} showLeading={false} />;

  if (query.error || !query.data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          <Touchable
            onPress={() => router.back()}
            style={styles.back}
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={palette.stone} strokeWidth={1.8} />
          </Touchable>
          <ErrorState
            message={
              query.error instanceof ApiError
                ? query.error.message
                : 'Could not load your targets.'
            }
            onRetry={() => void query.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Keyed on the loaded values so the fields initialise from them exactly once. */}
        <TargetsForm key={query.dataUpdatedAt} initial={query.data} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing['4xl'] },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.md,
  },
  title: { marginTop: spacing.base },
  sub: { marginTop: spacing.xs, marginBottom: spacing.xl },
  card: { gap: spacing.base },
  cta: { marginTop: spacing.xl },
});
