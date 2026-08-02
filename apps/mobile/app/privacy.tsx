import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon,
  ArrowLeft,
  Ban,
  Check,
  Download,
  Sparkles,
  Trash2,
} from 'lucide-react-native';
import {
  Button,
  Card,
  ErrorState,
  Input,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { SkeletonList } from '../src/components/Skeleton.js';
import { ApiError, api } from '../src/api/client.js';
import { healthSourceName } from '../src/health/healthkit.js';
import { connectHealth, useHealthSync } from '../src/health/useHealthSync.js';
import { connectCalendar, useCalendarSync } from '../src/calendar/useCalendarSync.js';
import { connectWeather, useWeatherSync } from '../src/weather/useWeatherSync.js';
import { connectLocation, useLocationSync } from '../src/location/useLocationSync.js';
import type {
  DataSourceItem,
  DataSourceStatus,
  InsightAvailability,
  ListResponse,
} from '../src/api/types.js';
import { useAuth } from '../src/store/auth.js';
import { MIN_TAP_TARGET, radius, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import type { Theme } from '../src/theme/theme.js';

const SOURCES_KEY = ['data-sources'] as const;
const AVAILABILITY_KEY = ['insights', 'availability'] as const;

const STATUS_LABEL: Record<DataSourceStatus, string> = {
  connected: 'Connected',
  disabled: 'Not enabled',
  denied: 'Not enabled',
  unavailable: 'Unavailable',
};

function statusColor(status: DataSourceStatus, t: Theme): string {
  if (status === 'connected') return t.accent;
  if (status === 'unavailable') return t.textFaint;
  return t.textMuted;
}

function formatSynced(iso: string | null): string {
  if (!iso) return 'Never synced';

  return `Last synced ${new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))}`;
}

/**
 * Connected Context.
 *
 * This screen exists so that a user can answer, at any moment: what do you know about
 * me, where did it come from, when did you last take it, can the AI see it, and how do
 * I make you stop. Two things it must never do — and the layout is built around both:
 *
 *  1. Collecting a source and letting a model reason about it are SEPARATE consents,
 *     shown as separate switches. Bundling them behind one toggle would be the exact
 *     dark pattern this product refuses.
 *  2. Only sources we can actually act on are listed. An `unavailable` source is
 *     filtered out rather than shown as a card of dead switches and four restatements
 *     of "not available" — a control that can never move implies a choice the user
 *     does not have.
 *
 *     This reverses an earlier decision that kept it visible, on the grounds that
 *     hiding what we cannot do turns a privacy screen into a receipt. That argument
 *     still has force, and the line to hold is this: notifications were never a source
 *     we offered, so their absence conceals nothing — but a source we once collected
 *     and have stopped must still appear, disabled and switchable, never vanish.
 */
export default function Privacy() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();

  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const sources = useQuery({
    queryKey: SOURCES_KEY,
    queryFn: () => api.get<ListResponse<DataSourceItem>>('/data-sources'),
  });

  const availability = useQuery({
    queryKey: AVAILABILITY_KEY,
    queryFn: () => api.get<InsightAvailability>('/insights/availability'),
  });

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ preferences: { storeReceipts: boolean } | null }>('/me'),
  });

  const setReceipts = useMutation({
    mutationFn: (storeReceipts: boolean) =>
      api.put<unknown>('/privacy/receipts', { storeReceipts }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['expense'] });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
  });

  const { sync: syncHealth } = useHealthSync(false);
  const { sync: syncCalendar } = useCalendarSync();
  const { sync: syncWeather } = useWeatherSync();
  const { sync: syncLocation } = useLocationSync();

  const updateSource = useMutation({
    mutationFn: async (input: {
      source: string;
      status: DataSourceStatus;
      aiAllowed: boolean;
    }) => {
      /**
       * iOS grants first, our record second.
       *
       * Writing "connected" before the system sheet is answered would leave a user who
       * declined it looking at a source that claims to be on and will never produce a
       * single number. Ask the OS, and only record consent if it got as far as asking.
       */
      if (input.source === 'health' && input.status === 'connected') {
        const result = await connectHealth();
        if (result === 'unavailable') {
          throw new Error(
            `${healthSourceName()} isn't available on this device.`,
          );
        }
        if (result === 'unauthorized') {
          // The store exists but the request failed. On a real iPhone this is the HealthKit
          // entitlement, which Apple only issues to a paid developer account — a free-Apple-ID
          // build reads Health fine in the Simulator but not on device. Say so, because no
          // amount of retrying or toggling Settings fixes a stripped entitlement.
          throw new Error(
            Platform.OS === 'ios'
              ? "Couldn't connect Apple Health. On a real device this needs the app signed with a paid Apple Developer account — a free Apple ID removes the Health entitlement. It works in the Simulator. If you're signed in with a paid account, check Health access for Synítheia in Settings."
              : `Couldn't connect ${healthSourceName()}. Check its permission in Settings and try again.`,
          );
        }
      }

      // Calendar needs no special entitlement — a plain OS grant, and ours only if it lands.
      if (input.source === 'calendar' && input.status === 'connected') {
        const result = await connectCalendar();
        if (result === 'unavailable') {
          throw new Error('This device has no calendar to read.');
        }
        if (result === 'unauthorized') {
          throw new Error(
            'Calendar access was not granted. You can allow it for Synítheia in Settings.',
          );
        }
      }

      // Weather rides on location permission — foreground only, and only the approximate area.
      if (input.source === 'weather' && input.status === 'connected') {
        const result = await connectWeather();
        if (result === 'unavailable') {
          throw new Error('This device cannot provide a location for weather.');
        }
        if (result === 'unauthorized') {
          throw new Error(
            'Weather needs location access to know where to look. You can allow it for Synítheia in Settings.',
          );
        }
      }

      // Location — the same foreground grant, used to recognise places rather than fetch weather.
      if (input.source === 'location' && input.status === 'connected') {
        const result = await connectLocation();
        if (result === 'unavailable') {
          throw new Error("This device can't provide a location.");
        }
        if (result === 'unauthorized') {
          throw new Error(
            'Location access was not granted. You can allow it for Synítheia in Settings.',
          );
        }
      }

      return api.put<unknown>(`/data-sources/${input.source}`, {
        status: input.status,
        aiAllowed: input.aiAllowed,
      });
    },

    onSuccess: (_result, input) => {
      // Pull straight away, so turning a source on visibly does something.
      if (input.source === 'health' && input.status === 'connected') void syncHealth();
      if (input.source === 'calendar' && input.status === 'connected') void syncCalendar();
      if (input.source === 'weather' && input.status === 'connected') void syncWeather();
      if (input.source === 'location' && input.status === 'connected') void syncLocation();
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: SOURCES_KEY }),

    onError: (error: unknown) => {
      Alert.alert(
        'Could not update',
        error instanceof Error ? error.message : 'Please try again.',
      );
    },
  });

  const setAiEnabled = useMutation({
    mutationFn: (aiEnabled: boolean) => api.put<unknown>('/privacy/ai', { aiEnabled }),

    onMutate: async (aiEnabled: boolean) => {
      await queryClient.cancelQueries({ queryKey: AVAILABILITY_KEY });
      const previous = queryClient.getQueryData<InsightAvailability>(AVAILABILITY_KEY);

      queryClient.setQueryData<InsightAvailability>(AVAILABILITY_KEY, (current) =>
        current ? { ...current, enabled: aiEnabled } : current,
      );

      return { previous };
    },

    onError: (_error, _value, context) => {
      if (context?.previous) queryClient.setQueryData(AVAILABILITY_KEY, context.previous);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: AVAILABILITY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
    },
  });

  /**
   * The export is handed straight to the share sheet. It is the user's data; the point
   * is that they can take it somewhere we have no part in.
   */
  async function exportData(): Promise<void> {
    setExporting(true);
    try {
      const payload = await api.get<unknown>('/privacy/export');
      await Share.share({ message: JSON.stringify(payload, null, 2) });
    } catch (error) {
      Alert.alert(
        'Export failed',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setExporting(false);
    }
  }

  const back = (
    <Touchable
      style={styles.iconButton}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      haptic={false}
      onPress={() => router.back()}
    >
      <ArrowLeft size={22} color={t.textPrimary} />
    </Touchable>
  );

  if (sources.isPending || availability.isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <SkeletonList />
      </SafeAreaView>
    );
  }

  if (sources.error || !sources.data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          <ErrorState
            message={
              sources.error instanceof Error
                ? sources.error.message
                : 'We could not load your connected context.'
            }
            onRetry={() => void sources.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const aiEnabled = availability.data?.enabled ?? false;
  const storeReceipts = me.data?.preferences?.storeReceipts ?? false;
  const aiConfigured = availability.data?.configured ?? false;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>{back}</View>

        <Text variant="overline" color={t.textFaint}>
          Privacy
        </Text>
        <Text variant="title" style={styles.heading}>
          Connected Context
        </Text>
        <Text variant="body" color={t.textMuted} style={styles.intro}>
          Everything Synítheia knows about you, and where it came from. A source you turn
          off here cannot be read again — even if the operating system still permits it.
        </Text>

        {/* ─── Receipt images ──────────────────────────────────────────────── */}
        <Card style={styles.aiCard}>
          <View style={styles.aiHeader}>
            <View style={styles.aiIcon}>
              <ImageIcon size={20} color={t.accent} strokeWidth={1.6} />
            </View>

            <View style={styles.aiCopy}>
              <Text variant="cardTitle">Keep receipt images</Text>
              <Text variant="caption" color={t.textMuted}>
                {storeReceipts
                  ? 'Receipt photos are saved to your account.'
                  : 'Receipt photos are not kept. Scanning still works.'}
              </Text>
            </View>

            <Switch
              value={storeReceipts}
              onValueChange={(next) => setReceipts.mutate(next)}
              trackColor={{ true: t.accent, false: t.border }}
              accessibilityLabel="Keep receipt images"
            />
          </View>

          {/*
            Said plainly, because it is the part that matters: turning this off does not
            merely stop future collection, it deletes what was already taken. A toggle
            that quietly keeps your old images is not a privacy control.
          */}
          <Text variant="caption" color={t.textFaint} style={styles.aiNote}>
            Images are stored on our server, not only on this phone. Turning this off
            deletes every receipt already saved.
          </Text>
        </Card>

        {/* ─── The master AI switch ────────────────────────────────────────── */}
        <Card style={styles.aiCard}>
          <View style={styles.aiHeader}>
            <View style={styles.aiIcon}>
              <Sparkles size={20} color={t.accent} strokeWidth={1.6} />
            </View>

            <View style={styles.aiCopy}>
              <Text variant="cardTitle">Synítheia AI</Text>
              <Text variant="caption" color={t.textFaint}>
                {aiConfigured
                  ? 'Off by default. Nothing is sent to a model until you turn this on.'
                  : 'Unavailable in this build — no model provider is configured.'}
              </Text>
            </View>

            <Switch
              value={aiEnabled}
              disabled={!aiConfigured}
              onValueChange={(value) => setAiEnabled.mutate(value)}
              accessibilityLabel="Synítheia AI enabled"
              trackColor={{ false: t.border, true: t.accent }}
              thumbColor={t.onAccent}
              ios_backgroundColor={t.border}
            />
          </View>
        </Card>

        {/* ─── The sources ─────────────────────────────────────────────────── */}
        <View style={styles.sources}>
          {sources.data.items
            .filter((item) => item.status !== 'unavailable')
            .map((item) => (
            <SourceCard
              key={item.source}
              item={item}
              aiEnabled={aiEnabled}
              onCollectChange={(collect) =>
                updateSource.mutate({
                  source: item.source,
                  status: collect ? 'connected' : 'disabled',
                  // Turning collection off withdraws it from the AI too — anything else
                  // would mean "off" did not mean off.
                  aiAllowed: collect ? item.aiAllowed : false,
                })
              }
              onAiChange={(aiAllowed) =>
                updateSource.mutate({
                  source: item.source,
                  status: item.status,
                  aiAllowed,
                })
              }
            />
          ))}
        </View>

        {/* ─── Your data ───────────────────────────────────────────────────── */}
        <Card style={styles.dataCard}>
          <Text variant="cardTitle">Your data</Text>

          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Export my data"
            accessibilityHint="Shares a full copy of everything we store about you"
            haptic={false}
            onPress={() => void exportData()}
            disabled={exporting}
            style={styles.dataRow}
          >
            <Download size={20} color={t.textPrimary} strokeWidth={1.6} />
            <View style={styles.dataCopy}>
              <Text variant="bodyMedium">
                {exporting ? 'Preparing your export…' : 'Export my data'}
              </Text>
              <Text variant="caption" color={t.textFaint}>
                Everything we store, as JSON, to take wherever you like.
              </Text>
            </View>
          </Touchable>

          <View style={styles.divider} />

          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            accessibilityHint="Permanently erases your account and all of its data"
            haptic={false}
            onPress={() => setDeleting(true)}
            style={styles.dataRow}
          >
            <Trash2 size={20} color={t.danger} strokeWidth={1.6} />
            <View style={styles.dataCopy}>
              <Text variant="bodyMedium" color={t.danger}>
                Delete account
              </Text>
              <Text variant="caption" color={t.textFaint}>
                Erased, not flagged. Your habits, spending, food, and history are gone for
                good.
              </Text>
            </View>
          </Touchable>
        </Card>
      </ScrollView>

      <DeleteAccountSheet
        visible={deleting}
        email={user?.email ?? ''}
        onClose={() => setDeleting(false)}
      />
    </SafeAreaView>
  );
}

function SourceCard({
  item,
  aiEnabled,
  onCollectChange,
  onAiChange,
}: {
  item: DataSourceItem;
  aiEnabled: boolean;
  onCollectChange: (collect: boolean) => void;
  onAiChange: (aiAllowed: boolean) => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const unavailable = item.status === 'unavailable';
  const connected = item.status === 'connected';

  return (
    <Card style={styles.source}>
      <View style={styles.sourceHeader}>
        <Text variant="cardTitle" style={styles.sourceTitle}>
          {item.title}
        </Text>

        <View style={[styles.badge, { borderColor: statusColor(item.status, t) }]}>
          {connected ? (
            <Check size={12} color={t.accent} strokeWidth={2.5} />
          ) : unavailable ? (
            <Ban size={12} color={t.textFaint} strokeWidth={2} />
          ) : null}
          <Text variant="caption" color={statusColor(item.status, t)}>
            {STATUS_LABEL[item.status]}
          </Text>
        </View>
      </View>

      {/* The `why` is written and served by the server, so the stated purpose cannot
          drift from the actual collection across an app-store release cycle. */}
      <Text variant="body" color={t.textMuted}>
        {item.why}
      </Text>

      <View style={styles.meta}>
        <Text variant="caption" color={t.textFaint}>
          {item.platforms}
        </Text>
        <Text variant="caption" color={t.textFaint}>
          {item.reliability}
        </Text>
        {!unavailable ? (
          <Text variant="caption" color={t.textFaint}>
            {`${formatSynced(item.lastSyncedAt)} · ${item.eventCount} ${
              item.eventCount === 1 ? 'event' : 'events'
            }`}
          </Text>
        ) : null}
      </View>

      {/* ── Two decisions, two switches, visibly apart ─────────────────────
          An unavailable source gets no switches at all. A control that can never
          move is not a control — it implies a choice the user does not have, and
          the badge and the explanation above already say the whole story. */}
      {!unavailable ? (
        <View style={styles.consents}>
          <View style={styles.consentRow}>
            <View style={styles.consentCopy}>
              <Text variant="bodyMedium" color={t.textPrimary}>
                Collect this data
              </Text>
              <Text variant="caption" color={t.textFaint}>
                Read it into your timeline and your day.
              </Text>
            </View>

            <Switch
              value={connected}
              onValueChange={onCollectChange}
              accessibilityLabel={`Collect ${item.title}`}
              trackColor={{ false: t.border, true: t.accent }}
              thumbColor={t.onAccent}
              ios_backgroundColor={t.border}
            />
          </View>

          <View style={styles.consentDivider} />

          <View style={styles.consentRow}>
            <View style={styles.consentCopy}>
              <View style={styles.aiLabel}>
                <Sparkles size={14} color={t.textMuted} strokeWidth={1.8} />
                <Text
                  variant="bodyMedium"
                  color={connected && aiEnabled ? t.textPrimary : t.textFaint}
                >
                  Let Synítheia AI use it
                </Text>
              </View>
              <Text variant="caption" color={t.textFaint}>
                {!connected
                  ? 'Turn collection on first — a source we do not read cannot be reasoned about.'
                  : !aiEnabled
                    ? 'Turn Synítheia AI on above to allow this.'
                    : 'A separate decision. You can keep a source and still keep it out of the model.'}
              </Text>
            </View>

            <Switch
              value={item.aiAllowed}
              disabled={!connected || !aiEnabled}
              onValueChange={onAiChange}
              accessibilityLabel={`Let Synítheia AI use ${item.title}`}
              trackColor={{ false: t.border, true: t.accent }}
              thumbColor={t.onAccent}
              ios_backgroundColor={t.border}
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/**
 * Typing your own email is a deliberate speed bump, and the friction is the point: this
 * is irreversible, and an irreversible action reachable by two taps is a trap.
 */
function DeleteAccountSheet({
  visible,
  email,
  onClose,
}: {
  visible: boolean;
  email: string;
  onClose: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const signOut = useAuth((s) => s.signOut);

  const [confirmEmail, setConfirmEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => api.delete<void>('/privacy/account', { confirmEmail: confirmEmail.trim() }),

    onSuccess: () => {
      onClose();
      // The account is gone; signOut clears the Keychain and drops the router to
      // signed-out. It tolerates the logout call failing, which it now will.
      void signOut();
    },

    onError: (err: unknown) => {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not delete this account.',
      );
    },
  });

  const matches = confirmEmail.trim().toLowerCase() === email.toLowerCase() && email.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Touchable
          style={styles.backdropDismiss}
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Cancel account deletion"
          onPress={onClose}
        />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.handle} />

            <Text variant="heading" style={styles.sheetTitle}>
              Delete your account
            </Text>

            <View style={styles.sheetBody}>
              <Text variant="body" color={t.textMuted}>
                This erases your habits, expenses, food, water, reminders, timeline, and
                every insight — permanently, not with a flag. There is no undo and no
                grace period.
              </Text>

              <Input
                label={`Type ${email} to confirm`}
                value={confirmEmail}
                onChangeText={(value) => {
                  setConfirmEmail(value);
                  setError(null);
                }}
                placeholder={email}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                error={error}
              />

              <Button
                label="Delete my account"
                disabled={!matches}
                loading={remove.isPending}
                haptic={false}
                onPress={() => remove.mutate()}
                style={styles.deleteButton}
              />

              <Button label="Keep my account" variant="ghost" onPress={onClose} />
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing['4xl'],
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
    heading: { marginTop: spacing.xs },
    intro: { marginTop: spacing.sm },
    aiCard: { marginTop: spacing.xl },
    aiHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    aiIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accentWash,
    },
    aiCopy: { flex: 1, gap: spacing.xs },
    aiNote: { marginTop: spacing.md },
    sources: { marginTop: spacing.xl, gap: spacing.base },
    source: { gap: spacing.md },
    sourceHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    sourceTitle: { flexShrink: 1 },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.full,
      borderWidth: 1,
      backgroundColor: t.surfaceRaised,
    },
    meta: { gap: spacing.xs },
    consents: {
      marginTop: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceRaised,
      paddingHorizontal: spacing.base,
    },
    consentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: MIN_TAP_TARGET + spacing.md,
      paddingVertical: spacing.md,
    },
    consentCopy: { flex: 1, gap: spacing.xs },
    consentDivider: {
      height: 1,
      backgroundColor: t.border,
    },
    aiLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    dataCard: { marginTop: spacing.xl, gap: spacing.sm },
    dataRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.base,
      minHeight: MIN_TAP_TARGET + spacing.sm,
      paddingVertical: spacing.sm,
    },
    dataCopy: { flex: 1, gap: spacing.xs },
    divider: {
      height: 1,
      backgroundColor: t.border,
    },
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: t.scrim,
    },
    backdropDismiss: { flex: 1 },
    // A real bottom sheet: transparent Modal, slides up over the scrim.
    sheet: {
      backgroundColor: t.surface,
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
      backgroundColor: t.border,
    },
    sheetTitle: { marginTop: spacing.lg },
    sheetBody: {
      marginTop: spacing.lg,
      gap: spacing.base,
      paddingBottom: spacing.xl,
    },
    deleteButton: { backgroundColor: t.danger },
  });
