import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BodyMetrics } from '@synitheia/shared';
import { ApiError, api } from '../api/client.js';
import { Button, Card, Chip, Input, Text } from '../components/primitives.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { spacing } from '../theme/theme.js';
import { bodyPatch, type BodyFormValues, type MissingBodyField } from './bodyForm.js';
import { dayBounds } from './dayBounds.js';
import { healthSourceName, storeHoldsIdentity } from './healthStore.js';

type Sex = NonNullable<BodyMetrics['biologicalSex']>;

const SEXES: { key: Sex; label: string }[] = [
  { key: 'female', label: 'Female' },
  { key: 'male', label: 'Male' },
  { key: 'other', label: 'Other' },
];

const EMPTY: BodyFormValues = { heightCm: '', weightKg: '', sex: null, birthDate: '' };

/**
 * Typing in what the health store did not supply.
 *
 * This is not a fallback for a broken connection — on Android it is the only route there
 * is. Health Connect has no record for sex or date of birth, so without this form the
 * resting-energy and calorie estimates could never be computed on an Android phone, and
 * the screen would tell the user to "add it there" about something that cannot be added.
 *
 * Only the fields actually missing are shown. Whatever is typed is kept by Synítheia and
 * never written back to the health store: the app declares no write access at all.
 */
export function BodyMissingForm({ missing }: { missing: readonly MissingBodyField[] }) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<BodyFormValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: Partial<BodyMetrics>) => api.patch<unknown>('/health/body', patch),
    onSuccess: () => {
      setValues(EMPTY);
      // The calorie target on Today is derived from these.
      void queryClient.invalidateQueries({ queryKey: ['health-body'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    },
  });

  const submit = () => {
    const result = bodyPatch(missing, values, dayBounds(0).localDate);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    save.mutate(result.patch);
  };

  const source = healthSourceName();
  const wantsIdentity = missing.includes('sex') || missing.includes('birthDate');

  return (
    <Card style={styles.card}>
      <Text variant="cardTitle">Add what’s missing</Text>
      <Text variant="caption" color={t.textMuted}>
        {wantsIdentity && !storeHoldsIdentity()
          ? `${source} doesn’t keep your sex or date of birth, so they can only be added here. `
          : ''}
        What you enter stays in Synítheia and is never written to {source}.
      </Text>

      {missing.includes('sex') ? (
        <View style={styles.field}>
          <Text variant="label" color={t.textMuted}>
            Sex
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {SEXES.map((option) => (
              <Chip
                key={option.key}
                label={option.label}
                selected={values.sex === option.key}
                onPress={() => setValues((v) => ({ ...v, sex: option.key }))}
                accessibilityLabel={`Sex: ${option.label}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      {missing.includes('birthDate') ? (
        <Input
          label="Date of birth"
          value={values.birthDate}
          onChangeText={(birthDate) => setValues((v) => ({ ...v, birthDate }))}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={10}
          accessibilityLabel="Date of birth, as year, month, day"
        />
      ) : null}

      {missing.includes('height') ? (
        <Input
          label="Height (cm)"
          value={values.heightCm}
          onChangeText={(heightCm) => setValues((v) => ({ ...v, heightCm }))}
          keyboardType="decimal-pad"
          accessibilityLabel="Height in centimetres"
        />
      ) : null}

      {missing.includes('weight') ? (
        <Input
          label="Weight (kg)"
          value={values.weightKg}
          onChangeText={(weightKg) => setValues((v) => ({ ...v, weightKg }))}
          keyboardType="decimal-pad"
          accessibilityLabel="Weight in kilograms"
        />
      ) : null}

      {error ? (
        <Text variant="caption" color={t.danger}>
          {error}
        </Text>
      ) : null}

      <Button label="Save" onPress={submit} loading={save.isPending} disabled={save.isPending} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, marginTop: spacing.lg },
  field: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
