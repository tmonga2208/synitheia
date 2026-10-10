import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BodyMetrics } from '@synitheia/shared';
import { ApiError, api } from '../api/client.js';
import { Button, Card, Chip, Input, Text } from '../components/primitives.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { spacing } from '../theme/theme.js';
import {
  bodyEdit,
  bodyPatch,
  formValuesFrom,
  storedFields,
  type BodyField,
  type BodyFormValues,
} from './bodyForm.js';
import { dayBounds } from './dayBounds.js';
import { healthSourceName, storeHoldsIdentity } from './healthStore.js';

type Sex = NonNullable<BodyMetrics['biologicalSex']>;

const SEXES: { key: Sex; label: string }[] = [
  { key: 'female', label: 'Female' },
  { key: 'male', label: 'Male' },
  { key: 'other', label: 'Other' },
];

const EMPTY: BodyFormValues = { heightCm: '', weightKg: '', sex: null, birthDate: '' };
const ALL_FIELDS: readonly BodyField[] = ['height', 'weight', 'sex', 'birthDate'];

interface BodyDetailsFormProps {
  stored: BodyMetrics;
  /**
   * `add` asks for what is missing; `edit` shows what is stored, filled in, to correct.
   * They never overlap: a field is either missing or stored.
   */
  mode: 'add' | 'edit';
  /** Edit only: called once the correction is saved, or abandoned. */
  onDone?: () => void;
}

/**
 * Typing in the body's measurements: what the health store did not supply, and — in edit
 * mode — corrections to what is already stored.
 *
 * This is not a fallback for a broken connection. On Android it is the only route there
 * is: Health Connect has no record for sex or date of birth, so without this form the
 * resting-energy and calorie estimates could never be computed on an Android phone.
 *
 * Whatever is typed is kept by Synítheia and never written back to the health store: the
 * app declares no write access at all.
 */
export function BodyDetailsForm({ stored, mode, onDone }: BodyDetailsFormProps) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const editing = mode === 'edit';

  // What the correction started from. Held still while the form is open, so that a sync
  // landing meanwhile cannot make an untouched field look like something the user changed.
  const [opened] = useState(stored);
  const [values, setValues] = useState<BodyFormValues>(() =>
    editing ? formValuesFrom(stored) : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);

  const fields = editing
    ? storedFields(opened)
    : ALL_FIELDS.filter((field) => !storedFields(stored).includes(field));

  const save = useMutation({
    mutationFn: (patch: Partial<BodyMetrics>) => api.patch<unknown>('/health/body', patch),
    onSuccess: async () => {
      // The calorie target on Today is derived from these.
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      // Awaited, so Save stays busy until the screen shows what was saved. Clearing or
      // closing the form first would flash the old values and look like nothing happened.
      await queryClient.invalidateQueries({ queryKey: ['health-body'] });
      setValues(EMPTY);
      onDone?.();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    },
  });

  const submit = () => {
    const today = dayBounds(0).localDate;
    const result = editing ? bodyEdit(opened, values, today) : bodyPatch(fields, values, today);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    save.mutate(result.patch);
  };

  const source = healthSourceName();
  const wantsIdentity = fields.includes('sex') || fields.includes('birthDate');

  return (
    <Card style={styles.card}>
      <Text variant="cardTitle">{editing ? 'Edit your details' : 'Add what’s missing'}</Text>
      <Text variant="caption" color={t.textMuted}>
        {editing
          ? 'Change what is wrong, or empty a field to remove it. '
          : wantsIdentity && !storeHoldsIdentity()
            ? `${source} doesn’t keep your sex or date of birth, so they can only be added here. `
            : ''}
        What you enter stays in Synítheia and is never written to {source}.
      </Text>

      {fields.includes('sex') ? (
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

      {fields.includes('birthDate') ? (
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

      {fields.includes('height') ? (
        <Input
          label="Height (cm)"
          value={values.heightCm}
          onChangeText={(heightCm) => setValues((v) => ({ ...v, heightCm }))}
          keyboardType="decimal-pad"
          accessibilityLabel="Height in centimetres"
        />
      ) : null}

      {fields.includes('weight') ? (
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
      {editing ? (
        <Button label="Cancel" variant="ghost" onPress={onDone} disabled={save.isPending} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, marginTop: spacing.lg },
  field: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
