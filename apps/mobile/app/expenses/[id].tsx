import { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '../../src/navigation/goBackOrHome.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft,
  Camera,
  ImageIcon,
  Repeat,
  Sparkles,
  Trash2,
} from 'lucide-react-native';
import { asMinor, formatMoney, netMinor, owedMinor, type Participant } from '@synitheia/shared';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  SectionHeader,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { SkeletonScreen } from '../../src/components/Skeleton.js';
import { DateField } from '../../src/components/DateField.js';
import { ReceiptConsentSheet } from '../../src/components/ReceiptConsentSheet.js';
import { api } from '../../src/api/client.js';
import { errorLine } from '../../src/api/errorCopy.js';
import { useAuth } from '../../src/store/auth.js';
import { radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../../src/theme/theme.js';

const ACCENT_COLOR = '#C08A7D';

interface WireExpenseDetail {
  _id: string;
  amountMinor: number;
  currency: string;
  categoryName: string;
  categoryColor: string;
  merchant: string | null;
  note: string | null;
  occurredAt: string;
  localDate: string;
  timezone: string;
  source: string;
  hasReceipt: boolean;
  paidBy: { name: string; contactId: string | null } | null;
  billAmountMinor: number | null;
  participants: Participant[];
}

interface DetailResponse {
  expense: WireExpenseDetail;
  receiptsAllowed: boolean;
}

/**
 * Where a row came from, in the user's words.
 *
 * The app adds expenses on the user's behalf — a recurring bill posts itself, a scanned
 * screenshot becomes a draft. It must always be able to say WHICH, and it must keep
 * saying it, not just at the moment it happened.
 */
const SOURCE_LABEL: Record<string, { label: string; explain: string }> = {
  manual: { label: 'Added by you', explain: 'You typed this in.' },
  subscription: {
    label: 'Recurring bill',
    explain: 'Added automatically on its due date, from a bill you set up.',
  },
  inferred: {
    label: 'Estimated',
    explain: 'Read from something you shared, and confirmed by you.',
  },
  import_screenshot: {
    label: 'From a screenshot',
    explain: 'Read from a payment screenshot you shared, and confirmed by you.',
  },
  import_text: {
    label: 'From a message',
    explain: 'Read from a message you pasted, and confirmed by you.',
  },
  import_pdf: { label: 'From a statement', explain: 'Read from a statement you imported.' },
  import_csv: { label: 'From a statement', explain: 'Read from a statement you imported.' },
};

export default function ExpenseDetail() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const accent = accentFor(ACCENT_COLOR, t);
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const timezone = useAuth((s) => s.user?.timezone) ?? 'UTC';

  const [askingConsent, setAskingConsent] = useState(false);
  const [pendingImage, setPendingImage] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['expense', id],
    queryFn: () => api.get<DetailResponse>(`/expenses/${id}`),
  });

  /**
   * The receipt lives in ImageKit as a PRIVATE file, so the app never gets a permanent
   * link — it asks for a short-lived signed URL each time it needs to show one. A link
   * that leaks into a log or a share sheet expires instead of being a lasting window into
   * someone's spending.
   */
  const receipt = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => api.get<{ url: string; expiresAt: string }>(`/expenses/${id}/receipt`),
    enabled: data?.expense.hasReceipt === true,
    // Re-mint before the signature expires rather than showing a broken image.
    staleTime: 45 * 60 * 1000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['expense', id] });
    void queryClient.invalidateQueries({ queryKey: ['receipt', id] });
    void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    void queryClient.invalidateQueries({ queryKey: ['today'] });
  };

  const upload = useMutation({
    meta: { reportsOwnError: true },
    mutationFn: (asset: ImagePicker.ImagePickerAsset) => {
      const form = new FormData();
      form.append('file', {
        uri: asset.uri,
        name: 'receipt.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as Blob);

      return api.upload<{ byteSize: number }>(`/expenses/${id}/receipt`, form);
    },
    onSuccess: invalidate,
  });

  const removeReceipt = useMutation({
    meta: { failed: 'Couldn’t remove the receipt' },
    mutationFn: () => api.delete<void>(`/expenses/${id}/receipt`),
    onSuccess: invalidate,
  });

  /**
   * Move the expense to a different moment.
   *
   * The server recomputes which local day it belongs to — that is not something the app
   * can be trusted to do, because the day an expense counts towards depends on the
   * timezone the expense was RECORDED in, not the one the phone happens to be in now.
   *
   * `today` and `expenses` are both invalidated because re-dating a row moves it between
   * days: leaving either stale shows the expense on two dates at once, or on neither.
   */
  const reschedule = useMutation({
    meta: { reportsOwnError: true },
    mutationFn: (occurredAt: Date) =>
      api.patch<unknown>(`/expenses/${id}`, { occurredAt: occurredAt.toISOString() }),
    onSuccess: invalidate,
  });

  const settle = useMutation({
    meta: { failed: 'Couldn’t update who has paid' },
    mutationFn: ({ index, settled }: { index: number; settled: boolean }) =>
      api.post<unknown>(`/expenses/${id}/settle`, { index, settled }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    meta: { failed: 'Couldn’t delete this expense' },
    mutationFn: () => api.delete<void>(`/expenses/${id}`),
    onSuccess: () => {
      invalidate();
      goBackOrHome(router);
    },
  });

  async function pickReceipt(source: 'camera' | 'library') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) return;

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });

    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;

    /**
     * Ask BEFORE the first image is ever sent. Storing a picture of where someone was
     * and what they bought is not a thing to start doing and mention later.
     */
    if (!data?.receiptsAllowed) {
      setPendingImage(asset);
      setAskingConsent(true);
      return;
    }

    upload.mutate(asset);
  }

  const back = (
    <Touchable
      onPress={() => goBackOrHome(router)}
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
            error={error}
            message="Could not load this expense."
            onRetry={() => void refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const e = data.expense;
  const provenance = SOURCE_LABEL[e.source] ?? SOURCE_LABEL.manual!;
  const owed = owedMinor(e.participants);
  const net = netMinor({ amountMinor: e.amountMinor, participants: e.participants });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {back}

        <Text variant="overline" color={e.categoryColor} style={{ marginTop: spacing.base }}>
          {e.categoryName}
        </Text>
        <Text variant="display" style={styles.amount}>
          {formatMoney(asMinor(e.amountMinor), e.currency)}
        </Text>

        <Text variant="heading">{e.merchant ?? e.categoryName}</Text>

        {/*
          The date is editable in place. It used to be a line of grey text, which meant an
          expense imported with the wrong day — or added late, on the day you remembered
          rather than the day you spent — was wrong forever.
        */}
        <View style={styles.when}>
          <DateField
            label="When"
            value={new Date(e.occurredAt)}
            timezone={timezone}
            disabled={reschedule.isPending}
            onChange={(next) => reschedule.mutate(next)}
          />

          {reschedule.error ? (
            <Text variant="caption" color={t.danger} style={{ marginTop: spacing.sm }}>
              {errorLine(reschedule.error, 'Couldn’t move this expense')}
            </Text>
          ) : null}
        </View>

        {e.note ? (
          <Card style={styles.note} elevated={false}>
            <Text variant="body">{e.note}</Text>
          </Card>
        ) : null}

        {/* Where this row came from. Kept visible, permanently, not just when it happened. */}
        <View style={styles.provenance}>
          {e.source === 'subscription' ? (
            <Repeat size={14} color={t.textMuted} strokeWidth={1.8} />
          ) : e.source === 'manual' ? null : (
            <Sparkles size={14} color={t.textMuted} strokeWidth={1.8} />
          )}
          <Text variant="caption" color={t.textMuted} style={{ flex: 1 }}>
            {provenance.label} · {provenance.explain}
          </Text>
        </View>

        {/* ─── Someone else paid ───────────────────────────────────────────── */}
        {e.paidBy ? (
          <>
            <SectionHeader title="Split" />

            {/*
              The amount at the top of this screen is YOUR SHARE, not the bill — you never
              had the ₹1,000. Saying both numbers, and which is which, is the only way this
              is not confusing.
            */}
            <Card style={styles.splitSummary} elevated={false}>
              <View style={styles.splitRow}>
                <Text variant="caption" color={t.textMuted}>
                  {e.paidBy.name} paid the bill
                </Text>
                <Text variant="bodyMedium" color={t.textMuted}>
                  {e.billAmountMinor !== null
                    ? formatMoney(asMinor(e.billAmountMinor), e.currency)
                    : '—'}
                </Text>
              </View>

              <View style={[styles.splitRow, styles.splitTotal]}>
                <Text variant="caption" color={t.textMuted}>
                  Your share
                </Text>
                <Text variant="cardTitle">
                  {formatMoney(asMinor(e.amountMinor), e.currency)}
                </Text>
              </View>
            </Card>
          </>
        ) : null}

        {/* ─── You paid, and people owe you ────────────────────────────────── */}
        {e.participants.length > 0 ? (
          <>
            <SectionHeader title="Split" />

            <Card style={styles.splitSummary} elevated={false}>
              <View style={styles.splitRow}>
                <Text variant="caption" color={t.textMuted}>
                  You paid
                </Text>
                <Text variant="bodyMedium">
                  {formatMoney(asMinor(e.amountMinor), e.currency)}
                </Text>
              </View>
              <View style={styles.splitRow}>
                <Text variant="caption" color={t.textMuted}>
                  Still owed to you
                </Text>
                <Text variant="bodyMedium" color={accent.text}>
                  {formatMoney(asMinor(owed), e.currency)}
                </Text>
              </View>
              <View style={[styles.splitRow, styles.splitTotal]}>
                <Text variant="caption" color={t.textMuted}>
                  Cost to you so far
                </Text>
                <Text variant="cardTitle">{formatMoney(asMinor(net), e.currency)}</Text>
              </View>
            </Card>

            {e.participants.map((p, index) => {
              const paid = p.settledAt !== null;

              return (
                <Card key={`${p.name}:${index}`} style={styles.person} padded={false}>
                  <View style={styles.personRow}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium">{p.name}</Text>
                      <Text variant="caption" color={t.textMuted}>
                        {paid
                          ? `Paid you ${formatMoney(asMinor(p.shareMinor), e.currency)}`
                          : `Owes ${formatMoney(asMinor(p.shareMinor), e.currency)}`}
                      </Text>
                    </View>

                    <Chip
                      label={paid ? 'Paid' : 'Mark paid'}
                      selected={paid}
                      accent={accent.text}
                      accessibilityLabel={
                        paid
                          ? `${p.name} has paid you. Tap to undo.`
                          : `Mark ${p.name} as having paid you`
                      }
                      onPress={() => settle.mutate({ index, settled: !paid })}
                    />
                  </View>
                </Card>
              );
            })}
          </>
        ) : null}

        {/* ─── Receipt ─────────────────────────────────────────────────────── */}
        <SectionHeader title="Receipt" />

        {e.hasReceipt && receipt.data ? (
          <>
            <Image
              source={{ uri: receipt.data.url }}
              style={styles.receipt}
              resizeMode="cover"
              accessibilityLabel="Receipt image"
            />

            <Touchable
              style={styles.removeReceipt}
              onPress={() =>
                Alert.alert('Remove receipt?', 'The image will be deleted.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => removeReceipt.mutate(),
                  },
                ])
              }
              accessibilityRole="button"
              accessibilityLabel="Remove receipt"
            >
              <Trash2 size={15} color={t.textFaint} strokeWidth={1.8} />
              <Text variant="caption" color={t.textFaint}>
                Remove receipt
              </Text>
            </Touchable>
          </>
        ) : (
          <View style={styles.receiptActions}>
            <Touchable
              style={styles.receiptAction}
              onPress={() => void pickReceipt('camera')}
              accessibilityRole="button"
              accessibilityLabel="Photograph a receipt"
            >
              <Camera size={20} color={t.accent} strokeWidth={1.6} />
              <Text variant="caption">Photograph it</Text>
            </Touchable>

            <Touchable
              style={styles.receiptAction}
              onPress={() => void pickReceipt('library')}
              accessibilityRole="button"
              accessibilityLabel="Choose a receipt image"
            >
              <ImageIcon size={20} color={t.accent} strokeWidth={1.6} />
              <Text variant="caption">Choose an image</Text>
            </Touchable>
          </View>
        )}

        {upload.isPending ? (
          <Text variant="caption" color={t.textMuted} style={{ marginTop: spacing.sm }}>
            Saving…
          </Text>
        ) : null}

        {upload.error ? (
          <Text variant="caption" color={t.danger} style={{ marginTop: spacing.sm }}>
            {errorLine(upload.error, 'Couldn’t save that image')}
          </Text>
        ) : null}

        <Button
          label="Delete expense"
          variant="ghost"
          style={{ marginTop: spacing['2xl'] }}
          onPress={() =>
            Alert.alert('Delete this expense?', 'This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
            ])
          }
        />
      </ScrollView>

      <ReceiptConsentSheet
        visible={askingConsent}
        onClose={() => {
          setAskingConsent(false);
          setPendingImage(null);
        }}
        onAllowed={() => {
          setAskingConsent(false);
          void queryClient.invalidateQueries({ queryKey: ['expense', id] });
          if (pendingImage) upload.mutate(pendingImage);
          setPendingImage(null);
        }}
      />
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
    amount: { marginTop: spacing.xs, marginBottom: spacing.md },
    when: { marginTop: spacing.base },
    // A nested inset panel sitting on the raw screen — matches the `sand → surfaceRaised`
    // reading used for the same pattern in SplitWith.tsx's summary panel.
    note: {
      backgroundColor: t.surfaceRaised,
      borderRadius: radius.md,
      marginTop: spacing.lg,
    },
    provenance: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.lg,
      marginBottom: spacing.xl,
    },
    splitSummary: {
      backgroundColor: t.surfaceRaised,
      borderRadius: radius.md,
      gap: spacing.xs,
      marginBottom: spacing.base,
    },
    splitRow: { flexDirection: 'row', justifyContent: 'space-between' },
    splitTotal: {
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingTop: spacing.sm,
      marginTop: spacing.xs,
    },
    person: { marginBottom: spacing.sm },
    personRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    receipt: {
      width: '100%',
      height: 320,
      borderRadius: radius.lg,
      backgroundColor: t.surfaceRaised,
    },
    removeReceipt: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: 44,
      marginTop: spacing.sm,
    },
    receiptActions: { flexDirection: 'row', gap: spacing.md },
    receiptAction: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: 96,
      borderRadius: radius.md,
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.border,
    },
  });
