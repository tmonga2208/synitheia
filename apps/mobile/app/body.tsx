import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, HeartPulse } from 'lucide-react-native';
import type { BmiBand, BodyInsight, BodyMetrics, CalorieGoal, CalorieTarget } from '@synitheia/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  SectionHeader,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { SkeletonScreen } from '../src/components/Skeleton.js';
import { ApiError, api } from '../src/api/client.js';
import { BodyMissingForm } from '../src/health/BodyMissingForm.js';
import { healthSourceName } from '../src/health/healthStore.js';
import { radius, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../src/theme/theme.js';

const KEY = ['health-body'] as const;
const ACCENT_COLOR = '#C08A7D';

interface BodyReport {
  body: BodyMetrics;
  insight: BodyInsight;
  goal: CalorieGoal | null;
  options: Record<CalorieGoal, CalorieTarget> | null;
  currentCalorieTarget: number;
  today: { steps: number | null; activeEnergyKcal: number | null };
}

const BAND_LABEL: Record<BmiBand, string> = {
  underweight: 'Underweight',
  healthy: 'Healthy range',
  overweight: 'Overweight',
  obese: 'Obese',
};

const GOALS: { key: CalorieGoal; label: string; blurb: string }[] = [
  { key: 'lose', label: 'Lose weight', blurb: 'About 0.5 kg a week' },
  { key: 'maintain', label: 'Stay here', blurb: 'Eat what you burn' },
  { key: 'gain', label: 'Gain weight', blurb: 'A modest surplus' },
];

const MISSING_LABEL: Record<BodyInsight['missing'][number], string> = {
  height: 'height',
  weight: 'weight',
  sex: 'sex',
  birthDate: 'date of birth',
};

/**
 * The body, and the calorie target derived from it.
 *
 * Every number here is shown with its provenance, because they are estimates and pretending
 * otherwise would be the app lying with a straight face. The target is never applied on its
 * own — the user taps a goal, and only then is it written.
 */
export default function Body() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ACCENT = accentFor(ACCENT_COLOR, t);
  const queryClient = useQueryClient();

  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<BodyReport>('/health/body'),
  });

  const pickGoal = useMutation({
    mutationFn: (goal: CalorieGoal) => api.put<BodyReport>('/health/calorie-goal', { goal }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });

  const back = (
    <Touchable
      onPress={() => router.back()}
      style={styles.back}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <ArrowLeft size={22} color={t.textPrimary} strokeWidth={1.8} />
    </Touchable>
  );

  if (isPending) return <SkeletonScreen />;

  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not load your body.'}
            onRetry={() => void refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const { insight, options, today } = data;

  // Named once, from the platform — never "Apple Health" hardcoded into copy.
  const source = healthSourceName();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={ACCENT.base}
          />
        }
      >
        {back}

        <Text variant="overline" color={ACCENT.text} style={{ marginTop: spacing.base }}>
          From {source}
        </Text>
        <Text variant="title">Your body</Text>

        {/*
          Nothing to compute from. Says exactly what is missing rather than showing a
          confident-looking number built on an assumed height.
        */}
        {insight.bmrKcal === null ? (
          <EmptyState
            icon={<HeartPulse size={26} color={t.onAccent} strokeWidth={1.6} />}
            title="Not enough to work with"
            body={`${source} has not shared your ${insight.missing
              .map((m) => MISSING_LABEL[m])
              .join(', ')}. Add ${insight.missing.length > 1 ? 'them' : 'it'} below.`}
          />
        ) : null}

        {/*
          The way out of the empty state. Not "add it in your health app": on Android that
          is impossible for sex and date of birth, which Health Connect does not hold.
        */}
        {insight.missing.length > 0 ? <BodyMissingForm missing={insight.missing} /> : null}

        {insight.bmi !== null ? (
          <Card style={styles.card} accent={ACCENT.base}>
            <Text variant="overline" color={t.textMuted}>
              BMI
            </Text>
            <View style={styles.figureRow}>
              <Text variant="title">{insight.bmi}</Text>
              <Text variant="body" color={ACCENT.text}>
                {insight.bmiBand ? BAND_LABEL[insight.bmiBand] : ''}
              </Text>
            </View>
            {/* Said once, plainly, rather than buried in a disclaimer nobody reads. */}
            <Text variant="caption" color={t.textFaint}>
              A rough ratio of weight to height. It cannot tell muscle from fat.
            </Text>
          </Card>
        ) : null}

        {insight.bmrKcal !== null && insight.tdee !== null ? (
          <Card style={styles.card}>
            <View style={styles.line}>
              <Text variant="bodyMedium">At rest</Text>
              <Text variant="bodyMedium" color={t.textMuted}>
                {insight.bmrKcal.toLocaleString()} kcal
              </Text>
            </View>

            <View style={styles.line}>
              <Text variant="bodyMedium">Burned today</Text>
              <Text variant="bodyMedium" color={t.textMuted}>
                {insight.tdee.kcal.toLocaleString()} kcal
              </Text>
            </View>

            {/*
              Which of the two routes produced this. A measured active-energy figure is a
              genuinely different claim from a step-bracket multiplier, and the difference
              is the user's to know.
            */}
            <Text variant="caption" color={t.textFaint}>
              {insight.tdee.estimated
                ? `Estimated from ${(today.steps ?? 0).toLocaleString()} steps — ${source} has not recorded your active energy today.`
                : `Measured: ${insight.bmrKcal.toLocaleString()} at rest plus ${(today.activeEnergyKcal ?? 0).toLocaleString()} active.`}
            </Text>
          </Card>
        ) : null}

        {options ? (
          <>
            <SectionHeader title="Calorie goal" />

            {GOALS.map((goal) => {
              const option = options[goal.key];
              const chosen = data.goal === goal.key;

              return (
                <Touchable
                  key={goal.key}
                  style={[
                    styles.goal,
                    chosen && { borderColor: ACCENT.base, backgroundColor: ACCENT.wash },
                  ]}
                  onPress={() => pickGoal.mutate(goal.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                  accessibilityLabel={`${goal.label}, ${option.kcal} calories a day`}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="cardTitle">{goal.label}</Text>
                    <Text variant="caption" color={t.textMuted}>
                      {goal.blurb}
                    </Text>
                  </View>

                  <View style={styles.goalFigure}>
                    <Text variant="cardTitle" color={chosen ? ACCENT.text : t.textPrimary}>
                      {option.kcal.toLocaleString()}
                    </Text>
                    <Text variant="caption" color={t.textFaint}>
                      kcal
                    </Text>
                  </View>
                </Touchable>
              );
            })}

            {/*
              Why the number is not simply "burned minus 500". A floored target is the app
              declining to recommend something harmful, and it should say so out loud rather
              than quietly showing a figure that does not match the arithmetic.
            */}
            {data.goal && options[data.goal].floored ? (
              <Text variant="caption" color={t.textMuted} style={styles.note}>
                Held at the lowest safe intake — a deeper deficit would put you under what
                your body burns at rest.
              </Text>
            ) : null}

            <Button
              label="Done"
              onPress={() => router.back()}
              style={{ marginTop: spacing.lg }}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'] },
    back: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing.md,
    },
    card: { gap: spacing.sm, marginTop: spacing.lg },
    figureRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
    line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    goal: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    goalFigure: { alignItems: 'flex-end' },
    note: { marginTop: spacing.sm, lineHeight: 18 },
  });
