import { useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBackOrHome } from '../../src/navigation/goBackOrHome.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, Info, Minus, PenLine, Plus } from 'lucide-react-native';
import {
  overallFoodConfidence,
  rescaleForPortion,
  type DraftFoodItem,
  type Macros,
  type MealType,
} from '@synitheia/shared';
import {
  Button,
  Card,
  Chip,
  SectionHeader,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { api } from '../../src/api/client.js';
import { errorLine } from '../../src/api/errorCopy.js';
import { radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import type { Theme } from '../../src/theme/theme.js';

interface WireIngestion {
  _id: string;
  mealType: MealType;
  items: DraftFoodItem[];
  caveat: string | null;
}

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** What the user is told about a number they are being asked to trust. */
function confidenceLabel(value: number, t: Theme): { label: string; color: string } {
  if (value >= 0.75) return { label: 'Confident', color: t.accent };
  if (value >= 0.5) return { label: 'Rough estimate', color: t.warning };
  return { label: 'Very rough — please check', color: t.danger };
}

interface ItemEdit {
  include: boolean;
  portionQty: number;
}

export default function FoodPhotoScreen() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();

  const [mealType, setMealType] = useState<MealType>(guessMeal());
  const [ingestion, setIngestion] = useState<WireIngestion | null>(null);
  const [edits, setEdits] = useState<ItemEdit[]>([]);
  /**
   * What went wrong, and the way on: read the same photo again, or (photo access refused
   * for good) open Settings. "Try again" used to only close the message.
   */
  const [failure, setFailure] = useState<{ message: string; next: 'retry' | 'settings' | null } | null>(
    null,
  );
  const [lastPhoto, setLastPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const analyze = useMutation({
    meta: { reportsOwnError: true },
    mutationFn: async (asset: ImagePicker.ImagePickerAsset) => {
      const form = new FormData();
      form.append('mealType', mealType);
      form.append('photo', {
        uri: asset.uri,
        name: 'meal.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as Blob);

      const res = await api.upload<{ ingestion: WireIngestion }>('/food/photo', form);
      return res.ingestion;
    },
    onMutate: () => setFailure(null),
    onSuccess: (result) => {
      setIngestion(result);
      setEdits(
        result.items.map((i) => ({ include: true, portionQty: i.portionQty })),
      );
    },
    onError: (err) => {
      setFailure({ message: errorLine(err, 'Couldn’t read that photo'), next: 'retry' });
    },
  });

  const confirm = useMutation({
    meta: { reportsOwnError: true },
    mutationFn: async () => {
      if (!ingestion) return;
      await api.post(`/food/photo/${ingestion._id}/confirm`, {
        mealType,
        items: edits
          .map((edit, itemIndex) => ({ edit, itemIndex }))
          .filter(({ edit }) => edit.include)
          .map(({ edit, itemIndex }) => ({
            itemIndex,
            portionQty: edit.portionQty,
          })),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['today'] });
      await queryClient.invalidateQueries({ queryKey: ['food'] });
      goBackOrHome(router);
    },
  });

  async function pick(source: 'camera' | 'library') {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!perm.granted) {
      setFailure({
        message:
          source === 'camera'
            ? 'Camera access is needed to photograph your meal.'
            : 'Photo access is needed to pick a picture of your meal.',
        // While the phone can still ask, the same button asks again; after that, only
        // Settings can change it.
        next: perm.canAskAgain ? null : 'settings',
      });
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });

    const asset = result.assets?.[0];
    if (!result.canceled && asset) {
      setLastPhoto(asset);
      analyze.mutate(asset);
    }
  }

  // Preview totals update live as the user drags a portion — computed with the SAME
  // shared helper the server uses on confirm, so the number they see is the number stored.
  const totals: Macros = (ingestion?.items ?? []).reduce<Macros>(
    (acc, item, i) => {
      const edit = edits[i];
      if (!edit?.include) return acc;
      const m = rescaleForPortion(item, edit.portionQty);
      return {
        calories: acc.calories + m.calories,
        proteinG: Math.round((acc.proteinG + m.proteinG) * 10) / 10,
        carbsG: Math.round((acc.carbsG + m.carbsG) * 10) / 10,
        fatG: Math.round((acc.fatG + m.fatG) * 10) / 10,
      };
    },
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  const anyIncluded = edits.some((e) => e.include);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Touchable
          onPress={() => goBackOrHome(router)}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.back}
          haptic={false}
        >
          <ArrowLeft size={22} color={t.textPrimary} strokeWidth={1.8} />
        </Touchable>

        <Text variant="title" style={{ marginTop: spacing.base }}>
          Log with a photo
        </Text>
        <Text variant="body" color={t.textMuted} style={{ marginTop: spacing.xs }}>
          Take a picture of your plate and we&apos;ll estimate what&apos;s in it. You
          confirm before anything is logged.
        </Text>

        {/* Meal picker */}
        <View style={styles.meals}>
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

        {!ingestion ? (
          <>
            <View style={styles.actions}>
              <Button
                label="Take a photo"
                onPress={() => void pick('camera')}
                loading={analyze.isPending}
                style={{ marginBottom: spacing.md }}
              />
              <Button
                label="Choose from library"
                variant="secondary"
                onPress={() => void pick('library')}
                disabled={analyze.isPending}
              />
            </View>

            {analyze.isPending ? (
              <View style={styles.analyzing}>
                <ActivityIndicator color={t.accent} />
                <Text variant="caption" color={t.textMuted}>
                  Looking at your plate…
                </Text>
              </View>
            ) : null}

            {failure ? (
              <Card style={styles.failure} accessibilityLiveRegion="polite">
                <Text variant="body">{failure.message}</Text>
                {failure.next === 'retry' && lastPhoto ? (
                  <Button
                    label="Try again"
                    variant="secondary"
                    onPress={() => analyze.mutate(lastPhoto)}
                    loading={analyze.isPending}
                  />
                ) : null}
                {failure.next === 'settings' ? (
                  <Button
                    label="Open Settings"
                    variant="secondary"
                    onPress={() => void Linking.openSettings()}
                  />
                ) : null}
              </Card>
            ) : null}

            {/*
              A camera is not always the right tool, and sometimes it fails outright — a
              blurry shot, a packet, a coffee with no plate. Typing it in must always be
              one tap away, or the failure is a dead end.
            */}
            <Touchable
              style={styles.manualRow}
              onPress={() => router.replace('/food/new')}
              accessibilityRole="button"
              accessibilityLabel="Add the meal by hand instead"
            >
              <PenLine size={18} color={t.textMuted} strokeWidth={1.8} />
              <Text variant="caption" color={t.textMuted}>
                Add it by hand instead
              </Text>
            </Touchable>
          </>
        ) : (
          <>
            <SectionHeader title="What we found" />

            {/**
             * The caveat is shown BEFORE the numbers, not buried under them. It is the
             * model's own statement of what would most change the estimate, and a user
             * about to trust a calorie count deserves to read it first.
             */}
            {ingestion.caveat ? (
              <Card style={styles.caveat} elevated={false}>
                <Info size={16} color={t.textMuted} strokeWidth={1.8} />
                <Text
                  variant="caption"
                  color={t.textMuted}
                  style={{ flex: 1, marginLeft: spacing.sm }}
                >
                  {ingestion.caveat}
                </Text>
              </Card>
            ) : null}

            {ingestion.items.map((item, i) => {
              const edit = edits[i];
              if (!edit) return null;

              const macros = rescaleForPortion(item, edit.portionQty);
              const conf = confidenceLabel(overallFoodConfidence(item), t);
              const step = item.portionUnit === 'g' || item.portionUnit === 'ml' ? 25 : 0.5;

              return (
                <Card
                  key={`${item.name}:${i}`}
                  style={[styles.item, !edit.include && styles.itemExcluded]}
                >
                  <View style={styles.itemHeader}>
                    <View style={{ flex: 1 }}>
                      <Text variant="cardTitle">{item.name}</Text>
                      <Text
                        variant="caption"
                        color={conf.color}
                        style={{ marginTop: spacing.xs }}
                      >
                        {conf.label}
                      </Text>
                    </View>

                    <Chip
                      label={edit.include ? 'Adding' : 'Skipped'}
                      selected={edit.include}
                      accessibilityLabel={`${edit.include ? 'Skip' : 'Add'} ${item.name}`}
                      onPress={() =>
                        setEdits((prev) =>
                          prev.map((e, j) =>
                            j === i ? { ...e, include: !e.include } : e,
                          ),
                        )
                      }
                    />
                  </View>

                  {item.reasoning ? (
                    <Text
                      variant="caption"
                      color={t.textFaint}
                      style={{ marginTop: spacing.sm }}
                    >
                      {item.reasoning}
                    </Text>
                  ) : null}

                  {/**
                   * Portion is the primary control, not a detail.
                   *
                   * It is the number the model is least sure about and the one that most
                   * moves the calorie count, so it gets the stepper — and the calories
                   * update live beside it, which is what teaches the user that the
                   * estimate hinges on this and not on the food's name.
                   */}
                  <View style={styles.portionRow}>
                    <Touchable
                      onPress={() =>
                        setEdits((prev) =>
                          prev.map((e, j) =>
                            j === i
                              ? { ...e, portionQty: Math.max(step, e.portionQty - step) }
                              : e,
                          ),
                        )
                      }
                      style={styles.stepper}
                      accessibilityRole="button"
                      accessibilityLabel={`Decrease portion of ${item.name}`}
                    >
                      <Minus size={18} color={t.textPrimary} strokeWidth={2} />
                    </Touchable>

                    <View style={styles.portionValue}>
                      <Text variant="cardTitle">
                        {Math.round(edit.portionQty * 10) / 10} {item.portionUnit}
                      </Text>
                      <Text variant="caption" color={t.textMuted}>
                        {macros.calories} kcal · {macros.proteinG}p · {macros.carbsG}c ·{' '}
                        {macros.fatG}f
                      </Text>
                    </View>

                    <Touchable
                      onPress={() =>
                        setEdits((prev) =>
                          prev.map((e, j) =>
                            j === i ? { ...e, portionQty: e.portionQty + step } : e,
                          ),
                        )
                      }
                      style={styles.stepper}
                      accessibilityRole="button"
                      accessibilityLabel={`Increase portion of ${item.name}`}
                    >
                      <Plus size={18} color={t.textPrimary} strokeWidth={2} />
                    </Touchable>
                  </View>
                </Card>
              );
            })}

            <Card style={styles.totals} accent={t.accent}>
              <Text variant="overline" color={t.textMuted}>
                Total
              </Text>
              <Text variant="title" style={{ marginTop: spacing.xs }}>
                {totals.calories} kcal
              </Text>
              <Text variant="caption" color={t.textMuted}>
                {totals.proteinG}g protein · {totals.carbsG}g carbs · {totals.fatG}g fat
              </Text>
            </Card>

            {/* Inline, not a toast: this screen is a modal, which sits above the toast layer
                on iOS, so a toast here would go unseen. */}
            {confirm.error ? (
              <Text
                variant="caption"
                color={t.danger}
                style={{ marginTop: spacing.lg }}
                accessibilityLiveRegion="polite"
              >
                {errorLine(confirm.error, 'Couldn’t log that meal')}
              </Text>
            ) : null}

            <Button
              label={anyIncluded ? 'Log this meal' : 'Nothing selected'}
              onPress={() => confirm.mutate()}
              loading={confirm.isPending}
              disabled={!anyIncluded}
              style={{ marginTop: spacing.lg }}
            />

            <Button
              label="Retake"
              variant="ghost"
              onPress={() => {
                setIngestion(null);
                setEdits([]);
              }}
              style={{ marginTop: spacing.sm }}
            />
          </>
        )}
      </ScrollView>
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
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'] },
    back: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing.md,
    },
    meals: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.lg,
      marginBottom: spacing.xl,
    },
    actions: { marginTop: spacing.md },
    analyzing: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xl,
    },
    failure: { gap: spacing.md, marginTop: spacing.base },
    manualRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: 44,
      marginTop: spacing.base,
    },
    caveat: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: t.surfaceRaised,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.base,
    },
    item: { marginBottom: spacing.md },
    itemExcluded: { opacity: 0.5 },
    itemHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    portionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.base,
    },
    stepper: {
      width: 44,
      height: 44,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    portionValue: { flex: 1, alignItems: 'center' },
    totals: { marginTop: spacing.base },
  });
