import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Camera,
  PenLine,
  Sparkles,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react-native';
import type { Macros, MealType, TodayResponse } from '@synitheia/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { ProgressRing } from '../src/components/ProgressRing.js';
import { ApiError, api } from '../src/api/client.js';
import { useAuth } from '../src/store/auth.js';
import { accentFor, palette, radius, spacing } from '../src/theme/tokens.js';

const FOOD_KEY = ['food'] as const;
const ACCENT = accentFor('#B0917D');

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

interface WireFoodEntry {
  _id: string;
  name: string;
  mealType: MealType;
  macros: Macros;
  loggedAt: string;
  /** 'inferred' when it came from a photo estimate rather than being typed. */
  source: string;
}

interface FoodResponse {
  items: WireFoodEntry[];
  daily: { totals: Macros; entryCount: number };
}

/**
 * Nutrition, in detail.
 *
 * Grouped by meal rather than listed by time, because "what did I have for lunch" is
 * the question people actually ask — a flat chronological list makes them do the
 * grouping in their head.
 *
 * Photo-estimated entries are marked. The app must always be able to tell the user which
 * numbers they measured and which a model guessed from a picture, permanently — not just
 * in the moment they confirmed it.
 */
export default function NutritionScreen() {
  const queryClient = useQueryClient();
  const timezone = useAuth((s) => s.user?.timezone) ?? 'UTC';

  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: FOOD_KEY,
    queryFn: () => api.get<FoodResponse>('/food'),
  });

  /**
   * The target is the user's own, never a hardcoded default. /today is already cached
   * from the tab they arrived from, so this costs nothing — and a screen that silently
   * scored someone against 2,000 kcal when they set 2,600 would be quietly lying.
   */
  const today = useQuery({
    queryKey: ['today'],
    queryFn: () => api.get<TodayResponse>('/today'),
  });
  const target = today.data?.nutrition.calorieTarget ?? 2000;

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/food/${id}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: FOOD_KEY });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });

  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });

  const back = (
    <Touchable
      onPress={() => router.back()}
      style={styles.back}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <ArrowLeft size={22} color={palette.stone} strokeWidth={1.8} />
    </Touchable>
  );

  if (isPending) return <LoadingState label="Loading meals" />;

  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not load your meals.'}
            onRetry={() => void refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const totals = data.daily.totals;
  const percent = (totals.calories / target) * 100;

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
          Nutrition
        </Text>
        <Text variant="title">Today</Text>

        <View style={styles.ring}>
          <ProgressRing percent={percent} color={ACCENT.base} size={200} strokeWidth={18}>
            <Text variant="title">{Math.round(totals.calories)}</Text>
            <Text variant="caption" color={palette.stoneMuted}>
              of {target.toLocaleString()} kcal
            </Text>
          </ProgressRing>
        </View>

        <View style={styles.macros}>
          {(
            [
              ['Protein', totals.proteinG],
              ['Carbs', totals.carbsG],
              ['Fat', totals.fatG],
            ] as const
          ).map(([label, grams]) => (
            <View key={label} style={styles.macro}>
              <Text variant="cardTitle">{Math.round(grams)}g</Text>
              <Text variant="caption" color={palette.stoneMuted}>
                {label}
              </Text>
            </View>
          ))}
        </View>

        {/*
          Two ways in, both first-class. The camera is faster when there is a plate in
          front of you; typing is the only option when there is not — a packet with the
          numbers on the back, a coffee, a meal you have logged fifty times.
        */}
        <View style={styles.addActions}>
          <Touchable
            style={styles.addAction}
            onPress={() => router.push('/food/photo')}
            accessibilityRole="button"
            accessibilityLabel="Photograph your meal"
          >
            <Camera size={20} color={palette.sage} strokeWidth={1.6} />
            <Text variant="caption">Photograph it</Text>
          </Touchable>

          <Touchable
            style={styles.addAction}
            onPress={() => router.push('/food/new')}
            accessibilityRole="button"
            accessibilityLabel="Add a meal by hand"
          >
            <PenLine size={20} color={palette.sage} strokeWidth={1.6} />
            <Text variant="caption">Add by hand</Text>
          </Touchable>
        </View>

        {data.items.length === 0 ? (
          <EmptyState
            icon={<UtensilsCrossed size={26} color={palette.white} strokeWidth={1.6} />}
            title="Nothing logged yet"
            body="Photograph your plate and we'll estimate what's in it — or type a meal in yourself."
            actionLabel="Add a meal"
            onAction={() => router.push('/food/new')}
          />
        ) : (
          MEAL_ORDER.map((meal) => {
            const entries = data.items.filter((i) => i.mealType === meal);
            if (entries.length === 0) return null;

            const kcal = entries.reduce((acc, e) => acc + e.macros.calories, 0);

            return (
              <View key={meal} style={styles.mealGroup}>
                <SectionHeader
                  title={meal[0]!.toUpperCase() + meal.slice(1)}
                  action={`${Math.round(kcal)} kcal`}
                />

                {entries.map((entry) => (
                  <Card key={entry._id} style={styles.entry} padded={false}>
                    <View style={styles.entryRow}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.entryTitle}>
                          <Text variant="cardTitle" numberOfLines={1}>
                            {entry.name}
                          </Text>

                          {/* Estimated, not measured — and it says so, for good. */}
                          {entry.source === 'inferred' ? (
                            <View style={styles.estimated}>
                              <Camera size={11} color={ACCENT.text} strokeWidth={2} />
                              <Text variant="caption" color={ACCENT.text}>
                                estimated
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        <Text variant="caption" color={palette.stoneMuted}>
                          {Math.round(entry.macros.calories)} kcal ·{' '}
                          {Math.round(entry.macros.proteinG)}p ·{' '}
                          {Math.round(entry.macros.carbsG)}c · {Math.round(entry.macros.fatG)}f
                          {'  ·  '}
                          {time.format(new Date(entry.loggedAt))}
                        </Text>
                      </View>

                      <Touchable
                        onPress={() => remove.mutate(entry._id)}
                        style={styles.delete}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${entry.name}`}
                      >
                        <Trash2 size={16} color={palette.stoneFaint} strokeWidth={1.7} />
                      </Touchable>
                    </View>
                  </Card>
                ))}
              </View>
            );
          })
        )}

        {data.items.some((i) => i.source === 'inferred') ? (
          <View style={styles.footnote}>
            <Sparkles size={13} color={palette.stoneFaint} strokeWidth={1.8} />
            <Text variant="caption" color={palette.stoneFaint} style={{ flex: 1 }}>
              Estimated meals came from a photo. Portion size is the least certain part —
              tap an entry to correct it.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
  content: { padding: spacing.lg, paddingBottom: spacing['4xl'] },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.md,
  },
  ring: { alignItems: 'center', marginVertical: spacing.xl },
  macros: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.xl,
  },
  macro: { alignItems: 'center' },
  addActions: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing['2xl'] },
  addAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 88,
    borderRadius: radius.md,
    backgroundColor: palette.sand,
    borderWidth: 1,
    borderColor: palette.surfaceDim,
  },
  mealGroup: { marginBottom: spacing.xl },
  entry: { marginBottom: spacing.sm },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  entryTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  estimated: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: ACCENT.wash,
  },
  delete: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  footnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.base,
  },
});
