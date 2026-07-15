import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  ClipboardPaste,
  FileText,
  Lock,
} from 'lucide-react-native';
import { currencyMeta, formatMoney, parseMoneyInput, ZERO } from '@synitheia/shared';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  Input,
  LoadingState,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { DateField } from '../../src/components/DateField.js';
import {
  SplitWith,
  resolveExpense,
  resplit,
  type SplitState,
} from '../../src/components/SplitWith.js';
import { ApiError, api } from '../../src/api/client.js';
import type {
  ListResponse,
  WireCategory,
  WireDraft,
  WireIngestion,
} from '../../src/api/types.js';
import { useAuth } from '../../src/store/auth.js';
import {
  MIN_TAP_TARGET,
  palette,
  radius,
  spacing,
  type as typeScale,
} from '../../src/theme/tokens.js';

const CATEGORIES_KEY = ['expense-categories'] as const;

/** Drawn from the habit accent palette so a custom category never looks bolted on. */
const CUSTOM_COLORS = [
  '#A98DA9',
  '#7DA095',
  '#8A9AA9',
  '#B0917D',
  '#7D8FA9',
  '#B08A8A',
] as const;

/** React Native's FormData takes a {uri,name,type} descriptor the DOM types have never heard of. */
interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

/**
 * The password field is appended BEFORE the file, and that order is load-bearing.
 *
 * The server reads the multipart parts in the order they arrive. A password sent after
 * the file has already been handed to the parser arrives too late to open it, and the
 * upload fails with "this statement is password-protected" no matter what you type.
 */
function fileForm(file: UploadFile, password?: string): FormData {
  const form = new FormData();
  if (password) form.append('password', password);
  form.append('file', file as unknown as Blob);
  return form;
}

/** Minor units → an editable major-unit string. The decimals come from the currency, never a constant. */
function toAmountInput(amountMinor: number, currency: string): string {
  const { decimals } = currencyMeta(currency);
  return (amountMinor / 10 ** decimals).toFixed(decimals);
}

/** What the user is proposing to keep from a parsed draft, before anything is written. */
interface DraftEdit {
  include: boolean;
  amount: string;
  merchant: string;
  categoryId: string | null;
}

function initialEdit(draft: WireDraft, categories: WireCategory[]): DraftEdit {
  const suggested = draft.suggestedCategoryName?.toLowerCase();

  const category =
    categories.find((c) => c.name.toLowerCase() === suggested) ??
    categories.find((c) => c.name === 'Other') ??
    categories[0];

  return {
    // A likely duplicate starts unchecked. The user opts INTO a second copy; they never
    // have to notice one and opt out.
    include: draft.duplicateOfExpenseId === null,
    amount: toAmountInput(draft.amountMinor, draft.currency),
    merchant: draft.merchant ?? '',
    categoryId: category?._id ?? null,
  };
}

export default function NewExpense() {
  const user = useAuth((s) => s.user);
  const currency = user?.currency ?? 'INR';
  const timezone = user?.timezone ?? 'UTC';
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [split, setSplit] = useState<SplitState>({ people: [], payer: null });
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * When it happened. Defaults to now, because that is what it usually is — but it is a
   * field, not an assumption. Expenses get added on the train home, not at the till.
   */
  const [occurredAt, setOccurredAt] = useState(() => new Date());

  const [pasting, setPasting] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestion, setIngestion] = useState<WireIngestion | null>(null);
  const [edits, setEdits] = useState<DraftEdit[]>([]);

  /**
   * A statement that turned out to be locked, held so it can be retried once the user
   * types the password — re-picking the file from scratch would be an absurd thing to ask.
   *
   * The password is component state and nothing else: never persisted, never logged, and
   * dropped the moment the statement opens. It is a key to someone's bank statement.
   */
  const [locked, setLocked] = useState<{ file: UploadFile; message: string } | null>(null);
  const [password, setPassword] = useState('');

  const categories = useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: () => api.get<ListResponse<WireCategory>>('/expense-categories'),
  });

  const categoryItems = useMemo(() => categories.data?.items ?? [], [categories.data]);

  /**
   * The eight defaults stay the eight defaults.
   *
   * A user's own categories used to be appended to the same row, so the more you made,
   * the more the everyday choices got pushed around and the harder Food was to find. They
   * now live behind "+ New" — which is where you already go when the defaults don't fit.
   */
  const systemCategories = useMemo(
    () => categoryItems.filter((c) => c.isSystem),
    [categoryItems],
  );
  const customCategories = useMemo(
    () => categoryItems.filter((c) => !c.isSystem),
    [categoryItems],
  );

  useEffect(() => {
    // Default to a system category — never to whichever of the user's own happens to
    // sort first, which would be an arbitrary choice they never made.
    if (categoryId === null && systemCategories.length > 0) {
      setCategoryId(systemCategories[0]?._id ?? null);
    }
  }, [systemCategories, categoryId]);

  /**
   * A new category is a colour too, and picking one for the user beats asking. The
   * palette is the habit-accent set, so a custom category looks like it belongs.
   */
  const createCategory = useMutation({
    mutationFn: () =>
      api.post<{ category: WireCategory }>('/expense-categories', {
        name: (newCategory ?? '').trim(),
        icon: 'circle-dashed',
        color: CUSTOM_COLORS[categoryItems.length % CUSTOM_COLORS.length]!,
      }),

    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      setCategoryId(result.category._id); // select it immediately
      setNewCategory(null);
    },

    onError: (err: unknown) => {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not create that category.',
      );
    },
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    void queryClient.invalidateQueries({ queryKey: ['today'] });
  }

  /**
   * The amount field is the TOTAL BILL, always — not what you personally spent.
   *
   * What gets LOGGED depends on who paid: the whole bill if it was you, your share alone
   * if a friend covered it. `resolveExpense` is the single place that decision is made,
   * and it is shared with the summary the user is looking at while they decide.
   */
  const billMinor = parseMoneyInput(amount, currency);
  const resolved = resolveExpense(billMinor, split);

  /**
   * Editing the bill after people are on the split must re-derive their shares. Otherwise
   * you type ₹1,000, add three friends at ₹250 each, correct it to ₹1,200 — and they
   * silently still owe ₹250 while you quietly eat the difference.
   */
  function changeAmount(next: string): void {
    setAmount(next);
    setSplit((current) => resplit(current, next, currency));
  }

  const create = useMutation({
    mutationFn: () =>
      api.post<unknown>('/expenses', {
        // What YOU are out — the bill if you paid it, your share if someone else did.
        amountMinor: resolved.amountMinor,
        billAmountMinor: resolved.billAmountMinor,
        paidBy: split.payer,
        categoryId,
        merchant: merchant.trim() === '' ? null : merchant.trim(),
        note: note.trim() === '' ? null : note.trim(),
        occurredAt: occurredAt.toISOString(),
        // Nobody owes you when a friend fronted the money.
        participants:
          split.payer === null && split.people.length > 0 ? split.people : undefined,
      }),

    onSuccess: () => {
      invalidate();
      router.back();
    },

    onError: (err: unknown) => {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not save this expense.',
      );
    },
  });

  /**
   * Every ingestion channel lands here, and every one of them produces DRAFTS.
   *
   * Nothing on this path writes an expense. The parsed artifact becomes a set of
   * proposals the user reviews, corrects, and explicitly confirms — Detect → Infer →
   * Suggest → Confirm. An expense tracker that silently invents rows from a screenshot
   * is a tracker nobody can trust the totals of.
   */
  const receive = useCallback(
    (result: { ingestion: WireIngestion }) => {
      setIngestion(result.ingestion);
      setEdits(result.ingestion.drafts.map((d) => initialEdit(d, categoryItems)));
      setError(result.ingestion.error);
      // It opened. Drop the password rather than leave it sitting in memory.
      setLocked(null);
      setPassword('');
    },
    [categoryItems],
  );

  async function runIngest(load: () => Promise<{ ingestion: WireIngestion } | null>) {
    setError(null);
    setIngesting(true);

    try {
      const result = await load();
      if (result) receive(result);
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'We could not read that. You can still add it by hand.',
      );
    } finally {
      setIngesting(false);
    }
  }

  /**
   * Send a statement, with the password if we have one.
   *
   * This does not go through `runIngest` because a locked statement is not a failure — it
   * is a question. Bank e-statements are almost always password-protected, so being asked
   * for one is the ORDINARY path, and it needs the file kept and the question asked, not
   * a red error and a shrug.
   *
   * The trigger is the error CODE, never the message: rewording the copy must not be able
   * to silently break the unlock flow.
   */
  async function sendStatement(file: UploadFile, secret?: string): Promise<void> {
    setError(null);
    setIngesting(true);

    try {
      receive(
        await api.upload<{ ingestion: WireIngestion }>(
          '/expenses/ingest/file',
          fileForm(file, secret),
        ),
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'pdf_password_required') {
        setLocked({ file, message: err.message });
        return;
      }

      setLocked(null);
      setPassword('');
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'We could not read that statement. You can still add it by hand.',
      );
    } finally {
      setIngesting(false);
    }
  }

  async function scanScreenshot(): Promise<{ ingestion: WireIngestion } | null> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Photo access is needed to read a payment screenshot.');
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return null;

    return api.upload<{ ingestion: WireIngestion }>(
      '/expenses/ingest/file',
      fileForm({
        uri: asset.uri,
        name: asset.fileName ?? 'screenshot.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      }),
    );
  }

  async function importStatement(): Promise<void> {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'text/csv', 'text/comma-separated-values'],
      copyToCacheDirectory: true,
    });

    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;

    // A fresh file starts a fresh question. Carrying the previous statement's password
    // over would try it against a document it has nothing to do with.
    setLocked(null);
    setPassword('');

    await sendStatement({
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? 'application/pdf',
    });
  }

  const confirm = useMutation({
    mutationFn: () => {
      if (!ingestion) throw new Error('Nothing to confirm');

      const confirmations = edits
        .map((edit, draftIndex) => ({ edit, draftIndex }))
        .filter(({ edit }) => edit.include && edit.categoryId !== null)
        .map(({ edit, draftIndex }) => {
          const draft = ingestion.drafts[draftIndex];
          const parsed = parseMoneyInput(edit.amount, draft?.currency ?? currency);

          if (parsed === null || parsed <= 0) {
            throw new Error('One of these amounts does not look right. Please check it.');
          }

          return {
            draftIndex,
            categoryId: edit.categoryId,
            amountMinor: parsed,
            merchant: edit.merchant.trim() === '' ? null : edit.merchant.trim(),
            ...(draft?.occurredAt ? { occurredAt: draft.occurredAt } : {}),
          };
        });

      if (confirmations.length === 0) {
        throw new Error('Select at least one transaction to add.');
      }

      return api.post<unknown>(`/expenses/ingestions/${ingestion._id}/confirm`, {
        confirmations,
      });
    },

    onSuccess: () => {
      invalidate();
      router.back();
    },

    onError: (err: unknown) => {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not add these expenses.',
      );
    },
  });

  function patchEdit(index: number, patch: Partial<DraftEdit>): void {
    setEdits((current) =>
      current.map((edit, i) => (i === index ? { ...edit, ...patch } : edit)),
    );
  }

  const back = (
    <Touchable
      style={styles.iconButton}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      haptic={false}
      onPress={() => router.back()}
    >
      <ArrowLeft size={22} color={palette.stone} />
    </Touchable>
  );

  if (categories.isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <LoadingState label="Loading categories" />
      </SafeAreaView>
    );
  }

  if (categories.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          <ErrorState
            message={
              categories.error instanceof Error
                ? categories.error.message
                : 'We could not load your categories.'
            }
            onRetry={() => void categories.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  // The bill must parse, and what actually gets logged must be more than nothing — a
  // "split" where your share works out to zero is not an expense you had.
  const manualValid =
    billMinor !== null &&
    billMinor > 0 &&
    categoryId !== null &&
    resolved.amountMinor !== null &&
    resolved.amountMinor > 0;
  const reviewing = ingestion !== null && ingestion.drafts.length > 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>{back}</View>

          <Text variant="title">{reviewing ? 'Review' : 'New expense'}</Text>
          <Text variant="body" color={palette.stoneMuted} style={styles.subtitle}>
            {reviewing
              ? 'We read these from what you shared. Nothing is saved until you confirm — check each one and correct anything we got wrong.'
              : 'Type it in, or hand us a screenshot, a message, or a statement and confirm what we read.'}
          </Text>

          {error ? (
            <Card style={styles.errorCard} accessibilityLiveRegion="polite">
              <Text variant="body" color={palette.danger}>
                {error}
              </Text>
            </Card>
          ) : null}

          {/*
            The statement is locked. Ask, rather than give up — this is what a bank
            e-statement normally is, and refusing it outright made the import feature
            useless for exactly the file people most want to import.
          */}
          {locked ? (
            <Card style={styles.unlock} accessibilityLiveRegion="polite">
              <View style={styles.unlockHead}>
                <Lock size={16} color={palette.stoneMuted} strokeWidth={1.8} />
                <Text variant="cardTitle" style={{ flex: 1 }}>
                  {locked.file.name}
                </Text>
              </View>

              <Text variant="body" color={palette.stoneMuted}>
                {locked.message}
              </Text>

              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Statement password"
                placeholderTextColor={palette.stoneFaint}
                secureTextEntry
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!ingesting}
                style={styles.passwordInput}
                accessibilityLabel="Statement password"
                onSubmitEditing={() => {
                  if (password) void sendStatement(locked.file, password);
                }}
              />

              <Text variant="caption" color={palette.stoneFaint}>
                Used once to open the file. It is never saved.
              </Text>

              <View style={styles.unlockActions}>
                <Button
                  label="Cancel"
                  variant="ghost"
                  onPress={() => {
                    setLocked(null);
                    setPassword('');
                  }}
                />
                <Button
                  label="Unlock"
                  style={{ flex: 1 }}
                  loading={ingesting}
                  disabled={password.length === 0 || ingesting}
                  onPress={() => void sendStatement(locked.file, password)}
                />
              </View>
            </Card>
          ) : null}

          {reviewing ? (
            <>
              <View style={styles.drafts}>
                {ingestion.drafts.map((draft, index) => {
                  const edit = edits[index];
                  if (!edit) return null;

                  return (
                    <DraftCard
                      key={`${ingestion._id}:${index}`}
                      draft={draft}
                      edit={edit}
                      categories={categoryItems}
                      onChange={(patch) => patchEdit(index, patch)}
                    />
                  );
                })}
              </View>

              <Button
                label="Add selected"
                loading={confirm.isPending}
                onPress={() => confirm.mutate()}
                style={styles.cta}
              />

              <Button
                label="Discard"
                variant="ghost"
                onPress={() => {
                  setIngestion(null);
                  setEdits([]);
                  setError(null);
                }}
              />
            </>
          ) : (
            <>
              {/* ─── By hand ─────────────────────────────────────────────── */}
              <Card style={styles.card}>
                <Input
                  label={split.people.length > 0 ? 'Total bill' : 'Amount'}
                  value={amount}
                  onChangeText={(value) => {
                    changeAmount(value);
                    setError(null);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  leading={
                    <Text variant="cardTitle" color={palette.stoneFaint}>
                      {currencyMeta(currency).symbol}
                    </Text>
                  }
                  error={
                    amount.trim() !== '' && billMinor === null
                      ? 'That does not look like an amount'
                      : null
                  }
                />

                <View>
                  <Text variant="label" color={palette.stoneMuted} style={styles.fieldLabel}>
                    Category
                  </Text>
                  <View style={styles.pills}>
                    {systemCategories.map((category) => (
                      <Chip
                        key={category._id}
                        label={category.name}
                        accent={category.color}
                        selected={categoryId === category._id}
                        accessibilityLabel={`Category ${category.name}`}
                        onPress={() => setCategoryId(category._id)}
                      />
                    ))}

                    {/*
                      Selected-but-hidden would be a trap: if the chosen category is one of
                      yours, it stays visible in the row so you can see what is actually
                      selected. It is only the *unselected* custom ones that live behind
                      "+ New".
                    */}
                    {customCategories
                      .filter((c) => c._id === categoryId && newCategory === null)
                      .map((category) => (
                        <Chip
                          key={category._id}
                          label={category.name}
                          accent={category.color}
                          selected
                          accessibilityLabel={`Category ${category.name}`}
                          onPress={() => setCategoryId(category._id)}
                        />
                      ))}

                    <Chip
                      label={newCategory === null ? '+ New' : 'Done'}
                      accent={palette.stoneMuted}
                      selected={newCategory !== null}
                      accessibilityLabel={
                        newCategory === null
                          ? 'Show your own categories'
                          : 'Close your categories'
                      }
                      onPress={() => setNewCategory(newCategory === null ? '' : null)}
                    />
                  </View>

                  {newCategory !== null ? (
                    <View style={styles.customPanel}>
                      {customCategories.length > 0 ? (
                        <>
                          <Text variant="caption" color={palette.stoneMuted}>
                            Your categories
                          </Text>

                          <View style={styles.pills}>
                            {customCategories.map((category) => (
                              <Chip
                                key={category._id}
                                label={category.name}
                                accent={category.color}
                                selected={categoryId === category._id}
                                accessibilityLabel={`Category ${category.name}`}
                                onPress={() => {
                                  setCategoryId(category._id);
                                  setNewCategory(null);
                                }}
                              />
                            ))}
                          </View>
                        </>
                      ) : null}

                      {/*
                        Created AND selected in one motion. Making the user create it, then
                        hunt for it, then tap it, is three steps for something they already
                        decided.
                      */}
                      <View style={styles.newCategory}>
                        <View style={{ flex: 1 }}>
                          <Input
                            value={newCategory}
                            onChangeText={setNewCategory}
                            placeholder="New category name"
                            accessibilityLabel="New category name"
                            autoFocus
                            maxLength={40}
                            returnKeyType="done"
                            onSubmitEditing={() => createCategory.mutate()}
                          />
                        </View>

                        <Button
                          label="Add"
                          fullWidth={false}
                          loading={createCategory.isPending}
                          disabled={newCategory.trim().length === 0}
                          onPress={() => createCategory.mutate()}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>

                <Input
                  label="Merchant (optional)"
                  value={merchant}
                  onChangeText={setMerchant}
                  placeholder="Blue Tokai"
                  maxLength={120}
                />

                {/*
                  Defaults to now, which is right most of the time — but "most of the time"
                  is not "always", and an expense you log on the way home belongs to the
                  meal, not to the train.
                */}
                <DateField
                  label="When"
                  value={occurredAt}
                  timezone={timezone}
                  onChange={setOccurredAt}
                />

                <Input
                  label="Note (optional)"
                  value={note}
                  onChangeText={setNote}
                  placeholder="Coffee with Ana"
                  maxLength={500}
                />

                <SplitWith
                  billMinor={billMinor}
                  currency={currency}
                  value={split}
                  onChange={setSplit}
                />

                <Button
                  label="Add expense"
                  disabled={!manualValid}
                  loading={create.isPending}
                  onPress={() => create.mutate()}
                />
              </Card>

              {/*
                The heading is the whole explanation. The rationale for WHY this is a
                share-it-to-us flow rather than a background scraper is an engineering
                fact, not a user-facing one — it belongs in the README, and the Connected
                Context screen already states it in the one place a user might go looking.
              */}
              <Text variant="section" style={styles.sectionTitle}>
                Or import it
              </Text>

              <View style={styles.ingestRow}>
                <IngestAction
                  icon={<Camera size={20} color={palette.sage} strokeWidth={1.6} />}
                  label="Scan a screenshot"
                  busy={ingesting}
                  onPress={() => void runIngest(scanScreenshot)}
                />
                <IngestAction
                  icon={<ClipboardPaste size={20} color={palette.sage} strokeWidth={1.6} />}
                  label="Paste a message"
                  busy={ingesting}
                  onPress={() => setPasting(true)}
                />
                <IngestAction
                  icon={<FileText size={20} color={palette.sage} strokeWidth={1.6} />}
                  label="Import a statement"
                  busy={ingesting}
                  onPress={() => void importStatement()}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <PasteSheet
        visible={pasting}
        busy={ingesting}
        onClose={() => setPasting(false)}
        onSubmit={(text) => {
          setPasting(false);
          void runIngest(() =>
            api.post<{ ingestion: WireIngestion }>('/expenses/ingest/text', { text }),
          );
        }}
      />
    </SafeAreaView>
  );
}

function IngestAction({
  icon,
  label,
  busy,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={styles.ingest}
    >
      {busy ? <ActivityIndicator color={palette.sage} /> : icon}
      <Text variant="caption" color={palette.stoneMuted} center>
        {label}
      </Text>
    </Touchable>
  );
}

function DraftCard({
  draft,
  edit,
  categories,
  onChange,
}: {
  draft: WireDraft;
  edit: DraftEdit;
  categories: WireCategory[];
  onChange: (patch: Partial<DraftEdit>) => void;
}) {
  const duplicate = draft.duplicateOfExpenseId !== null;

  return (
    <Card style={[styles.draft, edit.include ? styles.draftIncluded : null]}>
      <View style={styles.draftHeader}>
        <Text variant="cardTitle">
          {formatMoney(
            // The draft's own currency, not the user's — a statement can be in another one.
            parseMoneyInput(edit.amount, draft.currency) ?? ZERO,
            draft.currency,
          )}
        </Text>

        <Chip
          label={edit.include ? 'Adding' : 'Skipped'}
          selected={edit.include}
          accessibilityLabel={
            edit.include ? 'This transaction will be added' : 'This transaction will be skipped'
          }
          onPress={() => onChange({ include: !edit.include })}
        />
      </View>

      {duplicate ? (
        <View style={styles.duplicate}>
          <AlertTriangle size={14} color={palette.warning} strokeWidth={2} />
          <Text variant="caption" color={palette.warning} style={styles.duplicateCopy}>
            This looks like an expense you already have. Add it only if it really happened
            twice.
          </Text>
        </View>
      ) : null}

      {/* The exact substring we read this from, so the user can check our work. */}
      {draft.evidence ? (
        <Text variant="caption" color={palette.stoneFaint} numberOfLines={3}>
          {`“${draft.evidence}”`}
        </Text>
      ) : null}

      <Input
        label="Amount"
        value={edit.amount}
        onChangeText={(value) => onChange({ amount: value })}
        keyboardType="decimal-pad"
        leading={
          <Text variant="bodyMedium" color={palette.stoneFaint}>
            {currencyMeta(draft.currency).symbol}
          </Text>
        }
        error={
          parseMoneyInput(edit.amount, draft.currency) === null
            ? 'That does not look like an amount'
            : null
        }
      />

      <Input
        label="Merchant"
        value={edit.merchant}
        onChangeText={(value) => onChange({ merchant: value })}
        placeholder="Unknown"
        maxLength={120}
      />

      <View>
        <Text variant="label" color={palette.stoneMuted} style={styles.fieldLabel}>
          Category
        </Text>
        <View style={styles.pills}>
          {categories.map((category) => (
            <Chip
              key={category._id}
              label={category.name}
              accent={category.color}
              selected={edit.categoryId === category._id}
              accessibilityLabel={`Category ${category.name}`}
              onPress={() => onChange({ categoryId: category._id })}
            />
          ))}
        </View>
      </View>

      <Text variant="caption" color={palette.stoneFaint}>
        {`We are ${Math.round(draft.confidence * 100)}% sure we read this correctly.`}
      </Text>
    </Card>
  );
}

function PasteSheet({
  visible,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Touchable
          style={styles.backdropDismiss}
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
        />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.handle} />

            <Text variant="heading" style={styles.sheetTitle}>
              Paste a message
            </Text>
            <Text variant="caption" color={palette.stoneFaint} style={styles.sheetBody}>
              A transaction SMS, a payment confirmation, an email receipt — whatever you
              have.
            </Text>

            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
              maxLength={8000}
              placeholder="Rs. 450 debited from A/C XX1234 at BLUE TOKAI on 12 Jul…"
              placeholderTextColor={palette.stoneFaint}
              selectionColor={palette.sage}
              accessibilityLabel="Message text"
              style={styles.textArea}
            />

            <Button
              label="Read it"
              disabled={text.trim().length === 0}
              loading={busy}
              onPress={() => {
                onSubmit(text.trim());
                setText('');
              }}
              style={styles.sheetCta}
            />
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['3xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.base,
  },
  iconButton: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  subtitle: { marginTop: spacing.xs },
  card: { marginTop: spacing.xl, gap: spacing.base },
  fieldLabel: { marginBottom: spacing.sm },
  customPanel: {
    gap: spacing.md,
    marginTop: spacing.base,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: palette.surfaceDim,
  },
  newCategory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sectionTitle: { marginTop: spacing['2xl'] },
  ingestRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.base,
  },
  ingest: {
    flex: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.sand,
    borderWidth: 1,
    borderColor: palette.surfaceDim,
  },
  errorCard: {
    marginTop: spacing.lg,
    borderColor: palette.danger,
  },
  unlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  unlockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  passwordInput: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.sand,
    borderWidth: 1,
    borderColor: palette.surfaceDim,
    color: palette.stone,
    fontSize: 16,
    marginTop: spacing.xs,
  },
  unlockActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  drafts: { marginTop: spacing.xl, gap: spacing.base },
  draft: {
    gap: spacing.base,
    opacity: 0.6,
  },
  draftIncluded: { opacity: 1 },
  draftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  duplicate: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: palette.sand,
    borderWidth: 1,
    borderColor: palette.warning,
  },
  duplicateCopy: { flex: 1 },
  cta: { marginTop: spacing.xl },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: palette.scrim,
  },
  backdropDismiss: { flex: 1 },
  sheet: {
    backgroundColor: palette.bone,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 96,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: palette.surfaceDim,
  },
  sheetTitle: { marginTop: spacing.lg },
  sheetBody: { marginTop: spacing.xs },
  textArea: {
    marginTop: spacing.base,
    minHeight: 140,
    maxHeight: 220,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: palette.sand,
    color: palette.stone,
    textAlignVertical: 'top',
    ...typeScale.body,
  },
  sheetCta: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
});
