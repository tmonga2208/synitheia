import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Camera, Minus, Plus } from 'lucide-react-native';
import { scaleMacros, type Macros, type MealType } from '@synitheia/shared';
import {
  Button,
  Card,
  Chip,
  Input,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { api } from '../../src/api/client.js';
import { errorLine } from '../../src/api/errorCopy.js';
import { radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../../src/theme/theme.js';

const ACCENT_COLOR = '#B0917D';
const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Log a meal by hand.
 *
 * The photo path is the headline — pointing a camera at a plate is genuinely less work
 * than typing. But it is not the only way anyone eats: a packet has the numbers printed
 * on the back, a repeat meal you already know, a coffee with no plate to photograph. A
 * tracker that can only be fed by camera is a tracker you cannot use in a meeting.
 *
 * Macros are entered PER SERVING and the server multiplies. Keeping the multiplication in
 * one place is the same reason macros are snapshotted rather than re-looked-up: if the
 * rounding lives in two places, the two places will disagree.
 */
export default function NewFood() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ACCENT = accentFor(ACCENT_COLOR, t);
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [mealType, setMealType] = useState<MealType>(guessMeal());
  const [servings, setServings] = useState(1);

  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const [error, setError] = useState<string | null>(null);

  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const perServing: Macros = {
    calories: num(calories),
    proteinG: num(protein),
    carbsG: num(carbs),
    fatG: num(fat),
  };

  // The same helper the server uses, so the total shown here is the total that is stored.
  const total = scaleMacros(perServing, servings);

  const valid = name.trim().length > 0 && perServing.calories > 0;

  const create = useMutation({
    meta: { reportsOwnError: true },
    mutationFn: () =>
      api.post<unknown>('/food', {
        name: name.trim(),
        mealType,
        servings,
        macrosPerServing: perServing,
      }),

    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['food'] });
      await queryClient.invalidateQueries({ queryKey: ['today'] });
      router.back();
    },

    onError: (err) => {
      setError(errorLine(err, 'Couldn’t log that meal'));
    },
  });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Touchable
            onPress={() => router.back()}
            style={styles.back}
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={t.textPrimary} strokeWidth={1.8} />
          </Touchable>

          <Text variant="title" style={{ marginTop: spacing.base }}>
            Add a meal
          </Text>

          {/* The camera is still one tap away — this is the fallback, not a replacement. */}
          <Touchable
            style={styles.photoRow}
            onPress={() => router.replace('/food/photo')}
            accessibilityRole="button"
            accessibilityLabel="Photograph the meal instead"
          >
            <Camera size={18} color={ACCENT.text} strokeWidth={1.8} />
            <Text variant="caption" color={ACCENT.text}>
              Photograph it instead
            </Text>
          </Touchable>

          <Card style={styles.card}>
            <Input
              label="What did you eat?"
              value={name}
              onChangeText={setName}
              placeholder="Poha"
              accessibilityLabel="Food name"
              maxLength={120}
            />

            <View>
              <Text variant="label" color={t.textMuted} style={styles.label}>
                Meal
              </Text>
              <View style={styles.pills}>
                {MEALS.map((m) => (
                  <Chip
                    key={m}
                    label={m[0]!.toUpperCase() + m.slice(1)}
                    selected={mealType === m}
                    onPress={() => setMealType(m)}
                    accessibilityLabel={`Meal ${m}`}
                  />
                ))}
              </View>
            </View>

            <View>
              <Text variant="label" color={t.textMuted} style={styles.label}>
                Servings
              </Text>

              <View style={styles.stepper}>
                <Touchable
                  style={styles.stepButton}
                  onPress={() => setServings((s) => Math.max(0.5, s - 0.5))}
                  accessibilityRole="button"
                  accessibilityLabel="Fewer servings"
                >
                  <Minus size={18} color={t.textPrimary} strokeWidth={2} />
                </Touchable>

                <Text variant="cardTitle">{servings}</Text>

                <Touchable
                  style={styles.stepButton}
                  onPress={() => setServings((s) => Math.min(20, s + 0.5))}
                  accessibilityRole="button"
                  accessibilityLabel="More servings"
                >
                  <Plus size={18} color={t.textPrimary} strokeWidth={2} />
                </Touchable>
              </View>
            </View>
          </Card>

          <Card style={styles.card}>
            <Text variant="label" color={t.textMuted}>
              Per serving
            </Text>

            <Input
              label="Calories"
              value={calories}
              onChangeText={setCalories}
              placeholder="180"
              keyboardType="decimal-pad"
              accessibilityLabel="Calories per serving"
            />

            {/*
              Optional, deliberately. Somebody who only tracks calories should not have to
              invent a protein number to log their lunch — an invented macro is worse than
              a missing one, because it looks like data.
            */}
            <Text variant="caption" color={t.textFaint}>
              Macros are optional.
            </Text>

            <View style={styles.macros}>
              <View style={styles.macro}>
                <Input
                  label="Protein (g)"
                  value={protein}
                  onChangeText={setProtein}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  accessibilityLabel="Protein grams per serving"
                />
              </View>
              <View style={styles.macro}>
                <Input
                  label="Carbs (g)"
                  value={carbs}
                  onChangeText={setCarbs}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  accessibilityLabel="Carbohydrate grams per serving"
                />
              </View>
              <View style={styles.macro}>
                <Input
                  label="Fat (g)"
                  value={fat}
                  onChangeText={setFat}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  accessibilityLabel="Fat grams per serving"
                />
              </View>
            </View>
          </Card>

          {/* What will actually be logged, once servings are applied. */}
          {perServing.calories > 0 ? (
            <Card style={styles.total} accent={ACCENT.base}>
              <Text variant="overline" color={t.textMuted}>
                Logging
              </Text>
              <Text variant="title" style={{ marginTop: spacing.xs }}>
                {total.calories} kcal
              </Text>
              <Text variant="caption" color={t.textMuted}>
                {servings} {servings === 1 ? 'serving' : 'servings'} · {total.proteinG}g
                protein · {total.carbsG}g carbs · {total.fatG}g fat
              </Text>
            </Card>
          ) : null}

          {error ? (
            <Text variant="caption" color={t.danger}>
              {error}
            </Text>
          ) : null}

          <Button
            label="Log it"
            disabled={!valid}
            loading={create.isPending}
            onPress={() => create.mutate()}
            style={{ marginTop: spacing.base }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function guessMeal(): MealType {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 22) return 'dinner';
  return 'snack';
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.base },
    back: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing.md,
    },
    photoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 44,
    },
    card: { gap: spacing.base },
    label: { marginBottom: spacing.sm },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
    },
    stepButton: {
      width: 44,
      height: 44,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    macros: { flexDirection: 'row', gap: spacing.sm },
    macro: { flex: 1 },
    total: { marginTop: spacing.xs },
  });
