import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { ArrowLeft, Droplets, Trash2 } from 'lucide-react-native';
import { WATER_PRESETS_ML, formatVolume } from '@synitheia/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  SectionHeader,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { SkeletonScreen } from '../src/components/Skeleton.js';
import { ProgressRing } from '../src/components/ProgressRing.js';
import { api } from '../src/api/client.js';
import { deferWithUndo } from '../src/feedback/undo.js';
import { useAuth } from '../src/store/auth.js';
import { radius, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../src/theme/theme.js';

const WATER_KEY = ['water'] as const;
const ACCENT_COLOR = '#8A9AA9';

interface WireWaterEntry {
  _id: string;
  amountMl: number;
  loggedAt: string;
}

interface WaterResponse {
  items: WireWaterEntry[];
  totalMl: number;
  targetMl: number;
}

/**
 * Water, in detail.
 *
 * The Trackers grid deliberately carries only the number; this is where the ring and
 * the per-entry controls live. Progressive disclosure is the whole point — a glass of
 * water is a one-tap action, and "which glass did I log at 3pm, and can I undo it"
 * is a question you only ever ask on purpose.
 */
export default function WaterScreen() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ACCENT = accentFor(ACCENT_COLOR, t);
  const queryClient = useQueryClient();
  const timezone = useAuth((s) => s.user?.timezone) ?? 'UTC';

  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: WATER_KEY,
    queryFn: () => api.get<WaterResponse>('/water'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: WATER_KEY });
    void queryClient.invalidateQueries({ queryKey: ['today'] });
  };

  /**
   * A glass moves the ring at once. Waiting on the server made every tap feel unheard;
   * if the server refuses, the ring goes back and the failure is reported (app/_layout).
   */
  const add = useMutation({
    meta: { failed: 'Couldn’t log water' },
    mutationFn: (amountMl: number) =>
      api.post<unknown>('/water', { amountMl, clientKey: Crypto.randomUUID() }),

    onMutate: async (amountMl: number) => {
      await queryClient.cancelQueries({ queryKey: WATER_KEY });
      const previous = queryClient.getQueryData<WaterResponse>(WATER_KEY);
      const pending: WireWaterEntry = {
        _id: `pending-${Crypto.randomUUID()}`,
        amountMl,
        loggedAt: new Date().toISOString(),
      };

      // Newest first, as the server lists them.
      queryClient.setQueryData<WaterResponse>(WATER_KEY, (current) =>
        current
          ? { ...current, items: [pending, ...current.items], totalMl: current.totalMl + amountMl }
          : current,
      );
      return { previous };
    },

    onError: (_error, _amount, context) => {
      if (context?.previous) queryClient.setQueryData(WATER_KEY, context.previous);
    },

    onSettled: invalidate,
  });

  /**
   * One tap on the bin removes the entry from the screen and offers Undo; the server is
   * told only once the offer has gone (src/feedback/undo.ts).
   */
  function removeEntry(entry: WireWaterEntry) {
    let index = 0;

    deferWithUndo({
      message: `Removed ${formatVolume(entry.amountMl)}`,
      failed: 'Couldn’t remove that entry',
      apply: () =>
        queryClient.setQueryData<WaterResponse>(WATER_KEY, (current) => {
          if (!current) return current;
          index = Math.max(0, current.items.findIndex((item) => item._id === entry._id));
          return {
            ...current,
            items: current.items.filter((item) => item._id !== entry._id),
            totalMl: Math.max(0, current.totalMl - entry.amountMl),
          };
        }),
      revert: () =>
        queryClient.setQueryData<WaterResponse>(WATER_KEY, (current) => {
          if (!current || current.items.some((item) => item._id === entry._id)) return current;
          const items = [...current.items];
          items.splice(Math.min(index, items.length), 0, entry);
          return { ...current, items, totalMl: current.totalMl + entry.amountMl };
        }),
      commit: () => api.delete<void>(`/water/${entry._id}`).then(invalidate),
    });
  }

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
            message="Could not load your water."
            onRetry={() => void refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const percent = (data.totalMl / data.targetMl) * 100;

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
          Water
        </Text>
        <Text variant="title">Today</Text>

        <View style={styles.ring}>
          <ProgressRing percent={percent} color={ACCENT.base} size={200} strokeWidth={18}>
            <Text variant="title">{data.totalMl}</Text>
            <Text variant="caption" color={t.textMuted}>
              of {data.targetMl.toLocaleString()} ml
            </Text>
          </ProgressRing>
        </View>

        <View style={styles.presets}>
          {WATER_PRESETS_ML.map((ml) => (
            <Touchable
              key={ml}
              style={styles.preset}
              onPress={() => add.mutate(ml)}
              accessibilityRole="button"
              accessibilityLabel={`Log ${ml} millilitres`}
            >
              <Text variant="bodyMedium" color={ACCENT.text}>
                +{ml}
              </Text>
              <Text variant="caption" color={t.textFaint}>
                ml
              </Text>
            </Touchable>
          ))}
        </View>

        <SectionHeader title="Logged today" />

        {data.items.length === 0 ? (
          <EmptyState
            icon={<Droplets size={26} color={t.onAccent} strokeWidth={1.6} />}
            title="Nothing yet"
            body="Tap a glass above to log your first water of the day."
          />
        ) : (
          data.items.map((entry) => (
            <Card key={entry._id} style={styles.entry} padded={false}>
              <View style={styles.entryRow}>
                <View style={[styles.dot, { backgroundColor: ACCENT.base }]} />
                <Text variant="cardTitle" style={{ flex: 1 }}>
                  {entry.amountMl} ml
                </Text>
                <Text variant="caption" color={t.textMuted}>
                  {time.format(new Date(entry.loggedAt))}
                </Text>
                <Touchable
                  onPress={() => removeEntry(entry)}
                  // A glass still on its way to the server has nothing to delete yet.
                  disabled={entry._id.startsWith('pending-')}
                  style={styles.delete}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${entry.amountMl} millilitres logged at ${time.format(new Date(entry.loggedAt))}`}
                >
                  <Trash2 size={16} color={t.textFaint} strokeWidth={1.7} />
                </Touchable>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
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
    ring: { alignItems: 'center', marginVertical: spacing.xl },
    presets: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing['2xl'] },
    preset: {
      flex: 1,
      minHeight: 56,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    entry: { marginBottom: spacing.sm },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.base,
      paddingHorizontal: spacing.lg,
    },
    dot: { width: 8, height: 8, borderRadius: radius.full },
    delete: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  });
