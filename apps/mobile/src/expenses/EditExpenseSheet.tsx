import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery } from '@tanstack/react-query';
import { asMinor, currencyMeta, formatMoney } from '@synitheia/shared';
import { api } from '../api/client.js';
import { errorLine } from '../api/errorCopy.js';
import type { ListResponse, WireCategory } from '../api/types.js';
import { Button, Chip, Input, Text, Touchable } from '../components/primitives.js';
import { SheetSurface } from '../components/SheetSurface.js';
import { radius, spacing } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';
import { amountLocked, changesFrom, formFor, type EditableExpense } from './expenseEdit.js';

/** The same list New expense reads, so both share one copy of it. */
const CATEGORIES_KEY = ['expense-categories'] as const;

interface EditExpenseSheetProps {
  visible: boolean;
  id: string;
  expense: EditableExpense;
  onClose: () => void;
  /** After a save lands: the screen refreshes what the change touched. */
  onSaved: () => void;
}

/**
 * Change an expense's amount, category, payee or note.
 *
 * The date is not here: it is edited in place on the expense itself, where it already was.
 * The fields open on the expense as it is, and only what changes is sent.
 */
export function EditExpenseSheet({ visible, id, expense, onClose, onSaved }: EditExpenseSheetProps) {
  // A fresh form each time the sheet opens, so a change abandoned last time is not still
  // sitting in it. Counted during render rather than in an effect, so the first frame of
  // an opening sheet already shows the expense as it is now.
  const [wasVisible, setWasVisible] = useState(visible);
  const [opened, setOpened] = useState(0);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setOpened(opened + 1);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <EditBody key={opened} id={id} expense={expense} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function EditBody({ id, expense, onClose, onSaved }: Omit<EditExpenseSheetProps, 'visible'>) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [form, setForm] = useState(() => formFor(expense));
  const [showOwn, setShowOwn] = useState(false);
  const locked = amountLocked(expense);
  const result = changesFrom(expense, form);
  const changed = result.ok && Object.keys(result.changes).length > 0;

  const categories = useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: () => api.get<ListResponse<WireCategory>>('/expense-categories'),
  });
  const items = useMemo(() => categories.data?.items ?? [], [categories.data]);
  const system = items.filter((c) => c.isSystem);
  const own = items.filter((c) => !c.isSystem);

  const save = useMutation({
    // Shown in the sheet: it is a Modal, which sits above the toast layer on iOS.
    meta: { reportsOwnError: true },
    mutationFn: () => {
      if (!result.ok) throw new Error(result.error);
      return api.patch<unknown>(`/expenses/${id}`, result.changes);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.backdrop, { paddingTop: insets.top + spacing.sm }]}
    >
      <Touchable
        style={styles.dismiss}
        haptic={false}
        accessibilityRole="button"
        accessibilityLabel="Close without saving"
        onPress={onClose}
      />

      <SheetSurface style={styles.sheet}>
        <View style={styles.handle} />
        <Text variant="heading" style={styles.title}>
          Edit expense
        </Text>

        <ScrollView
          style={styles.fields}
          contentContainerStyle={styles.fieldsContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {locked ? (
            <View style={styles.lockedAmount}>
              <Text variant="label" color={t.textMuted}>
                Amount
              </Text>
              <Text variant="cardTitle">
                {formatMoney(asMinor(expense.amountMinor), expense.currency)}
              </Text>
              <Text variant="caption" color={t.textMuted}>
                Split with others, so it stays as it was split.
              </Text>
            </View>
          ) : (
            <Input
              label="Amount"
              value={form.amount}
              onChangeText={set('amount')}
              keyboardType="decimal-pad"
              leading={
                <Text variant="bodyMedium" color={t.textFaint}>
                  {currencyMeta(expense.currency).symbol}
                </Text>
              }
              error={result.ok ? null : result.error}
            />
          )}

          <View style={styles.categories}>
            <Text variant="label" color={t.textMuted}>
              Category
            </Text>
            <View style={styles.pills}>
              {system.map((category) => (
                <Chip
                  key={category._id}
                  label={category.name}
                  accent={category.color}
                  selected={form.categoryId === category._id}
                  accessibilityLabel={`Category ${category.name}`}
                  onPress={() => set('categoryId')(category._id)}
                />
              ))}
              {/* Your own categories wait behind one chip, as on New expense, except the
                  one this expense is in: hiding the current choice would hide the answer. */}
              {own
                .filter((category) => showOwn || form.categoryId === category._id)
                .map((category) => (
                  <Chip
                    key={category._id}
                    label={category.name}
                    accent={category.color}
                    selected={form.categoryId === category._id}
                    accessibilityLabel={`Category ${category.name}`}
                    onPress={() => set('categoryId')(category._id)}
                  />
                ))}
              {own.length > 0 ? (
                <Chip
                  label={showOwn ? 'Fewer' : 'Yours'}
                  accent={t.textMuted}
                  accessibilityLabel={showOwn ? 'Hide your own categories' : 'Show your own categories'}
                  onPress={() => setShowOwn((open) => !open)}
                />
              ) : null}
            </View>
          </View>

          <Input
            label="Merchant (optional)"
            value={form.merchant}
            onChangeText={set('merchant')}
            placeholder="Blue Tokai"
            maxLength={120}
            returnKeyType="done"
          />

          <Input
            label="Note (optional)"
            value={form.note}
            onChangeText={set('note')}
            placeholder="Coffee with Ana"
            maxLength={500}
            returnKeyType="done"
          />
        </ScrollView>

        {save.error ? (
          <Text variant="caption" color={t.danger} style={styles.error} accessibilityLiveRegion="polite">
            {errorLine(save.error, 'Couldn’t save your changes')}
          </Text>
        ) : null}

        <Button
          label="Save changes"
          loading={save.isPending}
          disabled={!changed}
          onPress={() => save.mutate()}
          style={styles.save}
        />
      </SheetSurface>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // The whole screen, so that with the keyboard up the sheet is held to the space left
    // above it and the fields scroll, rather than the top of the sheet going off screen.
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: t.scrim },
    dismiss: { flex: 1 },
    // A bottom sheet: t.surface, not t.surfaceRaised.
    sheet: {
      flexShrink: 1,
      backgroundColor: t.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.base,
    },
    handle: {
      alignSelf: 'center',
      width: 96,
      height: 6,
      borderRadius: radius.full,
      backgroundColor: t.border,
    },
    title: { marginTop: spacing.lg, marginBottom: spacing.base },
    fields: { flexGrow: 0, flexShrink: 1 },
    fieldsContent: { gap: spacing.base, paddingBottom: spacing.sm },
    lockedAmount: { gap: spacing.xs },
    categories: { gap: spacing.sm },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    error: { marginTop: spacing.sm },
    save: { marginTop: spacing.base },
  });
