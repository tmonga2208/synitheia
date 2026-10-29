import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
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
import { Image as ImageIcon, RefreshCw,
  ArrowLeft,
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
import { api } from '../src/api/client.js';
import { describeError, errorLine } from '../src/api/errorCopy.js';
import { nothingAllowedAlert } from '../src/health/healthCopy.js';
import { connectHealth, healthSourceName } from '../src/health/healthStore.js';
import { useHealthSync } from '../src/health/useHealthSync.js';
import { connectCalendar, useCalendarSync } from '../src/calendar/useCalendarSync.js';
import { connectWeather, useWeatherSync } from '../src/weather/useWeatherSync.js';
import { connectLocation, useLocationSync } from '../src/location/useLocationSync.js';
import type {
  DataSourceItem,
  DataSourceStatus,
  InsightAvailability,
  ListResponse,
} from '../src/api/types.js';
import { goBackOrHome } from '../src/navigation/goBackOrHome.js';
import { canForget, forgetConfirmation, forgottenNotice } from '../src/privacy/forgetSource.js';
import { useAuth } from '../src/store/auth.js';
import { backgroundSyncCopy } from '../src/sync/backgroundCopy.js';
import { syncBackgroundRegistration } from '../src/sync/backgroundTask.js';
import { readSourcePrefs, writeSourcePrefs } from '../src/sync/sourcePrefs.js';
import { useSourcePrefsMirror } from '../src/sync/useSourcePrefsMirror.js';
import { MIN_TAP_TARGET, radius, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import type { Theme } from '../src/theme/theme.js';

const SOURCES_KEY = ['data-sources'] as const;


/**
 * Ends a mutation whose failure the user has already been shown.
 *
 * The mutation's `onError` puts up a generic "Could not update" alert. When a branch has
 * something better to say — an alert with a way forward — it shows that and throws this,
 * so the generic one does not land on top of it.
 */
class AlreadyExplained extends Error {}

const HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata';

/** Health Connect's Play Store page. The `market:` form opens the store app directly. */
async function openHealthConnectInStore(): Promise<void> {
  try {
    await Linking.openURL(
      `market://details?id=${HEALTH_CONNECT_PACKAGE}&url=healthconnect%3A%2F%2Fonboarding`,
    );
  } catch {
    // No Play Store on this phone. The web page at least says what to look for.
    await Linking.openURL(
      `https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PACKAGE}`,
    ).catch(() => undefined);
  }
}
const AVAILABILITY_KEY = ['insights', 'availability'] as const;

/**
 * "Updated Oct 29, 1:04 PM · 12 entries", in the user's words: nothing about syncing or
 * events. Null when nothing has come in yet, so a fresh source shows no line at all.
 */
function sourceActivity(iso: string | null, count: number): string | null {
  if (!iso && count === 0) return null;
  const entries = `${count.toLocaleString()} ${count === 1 ? 'entry' : 'entries'}`;
  if (!iso) return entries;
  const when = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
  return `Updated ${when} · ${entries}`;
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

  // Connecting a source here must reach the background task without a trip via Today.
  useSourcePrefsMirror(sources.data?.items);

  const [backgroundSync, setBackgroundSync] = useState(true);

  useEffect(() => {
    void readSourcePrefs().then((prefs) => setBackgroundSync(prefs.background));
  }, []);

  const onBackgroundSyncChange = (value: boolean) => {
    // Optimistic: this is a local preference, and the write cannot meaningfully fail.
    setBackgroundSync(value);
    void writeSourcePrefs({ background: value }).then(() => syncBackgroundRegistration());
  };

  const availability = useQuery({
    queryKey: AVAILABILITY_KEY,
    queryFn: () => api.get<InsightAvailability>('/insights/availability'),
  });

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ preferences: { storeReceipts: boolean } | null }>('/me'),
  });

  const setReceipts = useMutation({
    meta: { failed: 'Couldn’t change whether receipts are kept' },
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
    meta: { reportsOwnError: true },
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
        if (result === 'update_required') {
          // Android 9 to 13, where Health Connect is a separate app that is missing or too
          // old. "Could not update" would leave the user with nowhere to go, so this alert
          // carries the way forward and the mutation ends quietly behind it.
          Alert.alert(
            'Health Connect needed',
            'Health Connect is missing or out of date on this phone. Install or update it from the Play Store, then turn this on again.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Play Store', onPress: () => void openHealthConnectInStore() },
            ],
          );
          throw new AlreadyExplained();
        }
        if (result === 'unauthorized' && Platform.OS !== 'ios') {
          // Android reports what was granted, and nothing was. That is not an error and
          // must not read like one — see nothingAllowedAlert for the ways a user gets here.
          const { title, message } = nothingAllowedAlert(healthSourceName());
          Alert.alert(title, message);
          throw new AlreadyExplained();
        }
        if (result === 'unauthorized') {
          // The store exists but the request failed. On a real iPhone this is the HealthKit
          // entitlement, which Apple only issues to a paid developer account — a free-Apple-ID
          // build reads Health fine in the Simulator but not on device. Say so, because no
          // amount of retrying or toggling Settings fixes a stripped entitlement.
          throw new Error(
            "Couldn't connect Apple Health. Check that Synítheia is allowed in the Health app, under Sharing, then try again.",
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
      if (error instanceof AlreadyExplained) return;

      Alert.alert('Couldn’t update this source', describeError(error).message);
    },
  });

  /**
   * "Delete this data" on a source. The server removes what the source added and turns it
   * off; the confirmation says what goes and what stays (src/privacy/forgetSource.ts).
   */
  const forgetSource = useMutation({
    meta: { reportsOwnError: true },
    mutationFn: (item: DataSourceItem) =>
      api.delete<{ deletedEvents: number }>(`/data-sources/${item.source}/data`),

    onSuccess: (result, item) => {
      const notice = forgottenNotice(item.title, result.deletedEvents);
      Alert.alert(notice.title, notice.message);
    },

    onError: (error: unknown) => {
      Alert.alert('Couldn’t delete this data', describeError(error).message);
    },

    // Every query, not a list of keys: the timeline, days, months, the body screen and
    // insights all show what a source added, and a key missed here would keep showing
    // deleted data until the app restarted.
    onSettled: () => queryClient.invalidateQueries(),
  });

  function confirmForget(item: DataSourceItem): void {
    const { title, message, confirm } = forgetConfirmation(item, healthSourceName());

    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirm, style: 'destructive', onPress: () => forgetSource.mutate(item) },
    ]);
  }

  const setAiEnabled = useMutation({
    meta: { failed: 'Couldn’t switch Synítheia AI' },
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
      Alert.alert('Couldn’t export your data', describeError(error).message);
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
      // Not router.back(): this screen can be the only one in the stack. See goBackOrHome.
      onPress={() => goBackOrHome(router)}
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
            error={sources.error}
            message="We could not load your connected context."
            onRetry={() => void sources.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const aiEnabled = availability.data?.enabled ?? false;
  const backgroundSources = sources.data.items.filter(
    (s) => (s.source === 'health' || s.source === 'calendar') && s.status === 'connected',
  );
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
          What Synítheia knows, and where it came from. A source you turn off is never read
          again, even if your phone still allows it.
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
                  ? 'Off until you turn it on. Nothing is shared before then.'
                  : 'Not available yet.'}
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
              onForget={() => confirmForget(item)}
              forgetting={forgetSource.isPending && forgetSource.variables?.source === item.source}
            />
          ))}
        </View>

        {/* ─── Background sync ─────────────────────────────────────────────────
            Only when there is something it would sync. A switch for a task that cannot
            run is the same non-choice as a switch on an unavailable source. */}
        {backgroundSources.length > 0 ? (
          <Card style={styles.aiCard}>
            <View style={styles.aiHeader}>
              <View style={styles.aiIcon}>
                <RefreshCw size={20} color={t.accent} strokeWidth={1.6} />
              </View>

              <View style={styles.aiCopy}>
                <Text variant="cardTitle">Sync in the background</Text>
                <Text variant="caption" color={t.textMuted}>
                  {backgroundSyncCopy(Platform.OS, {
                    health: backgroundSources.some((s) => s.source === 'health'),
                    calendar: backgroundSources.some((s) => s.source === 'calendar'),
                  })}
                </Text>
              </View>

              <Switch
                value={backgroundSync}
                onValueChange={onBackgroundSyncChange}
                accessibilityLabel="Sync in the background"
                trackColor={{ false: t.border, true: t.accent }}
                thumbColor={t.onAccent}
                ios_backgroundColor={t.border}
              />
            </View>
          </Card>
        ) : null}

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
  onForget,
  forgetting,
}: {
  item: DataSourceItem;
  aiEnabled: boolean;
  onCollectChange: (collect: boolean) => void;
  onAiChange: (aiAllowed: boolean) => void;
  onForget: () => void;
  forgetting: boolean;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const unavailable = item.status === 'unavailable';
  const activity = sourceActivity(item.lastSyncedAt, item.eventCount);
  const connected = item.status === 'connected';

  return (
    <Card style={styles.source}>
      {/* The source's name is the switch's label: "Weather", on or off. An unavailable
          source gets no switch at all — a control that can never move implies a choice
          the user does not have. */}
      <View style={styles.sourceHeader}>
        <Text variant="cardTitle" style={styles.sourceTitle}>
          {item.title}
        </Text>

        {unavailable ? (
          <Text variant="caption" color={t.textFaint}>
            Not available
          </Text>
        ) : (
          <Switch
            value={connected}
            onValueChange={onCollectChange}
            accessibilityLabel={`Use ${item.title}`}
            trackColor={{ false: t.border, true: t.accent }}
            thumbColor={t.onAccent}
            ios_backgroundColor={t.border}
          />
        )}
      </View>

      {/* The `why` is written and served by the server, so the stated purpose cannot
          drift from the actual collection across an app-store release cycle. */}
      <Text variant="label" color={t.textMuted}>
        {item.why}
      </Text>

      {connected && activity ? (
        <Text variant="caption" color={t.textFaint}>
          {activity}
        </Text>
      ) : null}

      {/* The AI switch appears once there is something for it to apply to. Shown greyed
          out under every source that is off, it repeated the same "turn the other one
          on first" note five times down the screen. */}
      {connected ? (
        <View style={styles.aiRow}>
          <View style={styles.consentCopy}>
            <View style={styles.aiLabel}>
              <Sparkles size={14} color={t.textMuted} strokeWidth={1.8} />
              <Text variant="bodyMedium" color={aiEnabled ? t.textPrimary : t.textFaint}>
                Let Synítheia AI use it
              </Text>
            </View>
            {!aiEnabled ? (
              <Text variant="caption" color={t.textFaint}>
                Turn Synítheia AI on above to allow this.
              </Text>
            ) : null}
          </View>

          <Switch
            value={item.aiAllowed}
            disabled={!aiEnabled}
            onValueChange={onAiChange}
            accessibilityLabel={`Let Synítheia AI use ${item.title}`}
            trackColor={{ false: t.border, true: t.accent }}
            thumbColor={t.onAccent}
            ios_backgroundColor={t.border}
          />
        </View>
      ) : null}

      {/* Switching a source off stops collection; this removes what it already took.
          Shown whenever there is something to remove, including after it is off. */}
      {canForget(item) ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${item.title} data`}
          accessibilityHint="Asks first. Deletes what this source added and turns it off."
          haptic={false}
          onPress={onForget}
          disabled={forgetting}
          style={styles.forgetRow}
        >
          <Trash2 size={18} color={t.danger} strokeWidth={1.6} />
          <Text variant="bodyMedium" color={t.danger}>
            {forgetting ? 'Deleting…' : 'Delete this data'}
          </Text>
        </Touchable>
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
    meta: { reportsOwnError: true },
    mutationFn: () => api.delete<void>('/privacy/account', { confirmEmail: confirmEmail.trim() }),

    onSuccess: () => {
      onClose();
      // The account is gone; signOut clears the Keychain and drops the router to
      // signed-out. It tolerates the logout call failing, which it now will.
      void signOut();
    },

    onError: (err: unknown) => {
      setError(errorLine(err, 'Couldn’t delete this account'));
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

        <KeyboardAvoidingView behavior="padding">
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
    source: { gap: spacing.sm },
    sourceHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    sourceTitle: { flexShrink: 1 },
    aiRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: MIN_TAP_TARGET,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
    },
    consentCopy: { flex: 1, gap: spacing.xs },
    aiLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    forgetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing.sm,
      minHeight: MIN_TAP_TARGET,
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
