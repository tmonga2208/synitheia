import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { ArrowLeft, Droplets, Trash2 } from 'lucide-react-native';
import { WATER_PRESETS_ML } from '@synitheia/shared';
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
import { ApiError, api } from '../src/api/client.js';
import { useAuth } from '../src/store/auth.js';
import { accentFor, palette, radius, spacing } from '../src/theme/tokens.js';

const WATER_KEY = ['water'] as const;
const ACCENT = accentFor('#8A9AA9');

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

  const add = useMutation({
    mutationFn: (amountMl: number) =>
      api.post<unknown>('/water', { amountMl, clientKey: Crypto.randomUUID() }),
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/water/${id}`),
    onSettled: invalidate,
  });

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
      <ArrowLeft size={22} color={palette.stone} strokeWidth={1.8} />
    </Touchable>
  );

  if (isPending) return <SkeletonScreen />;

  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not load your water.'}
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
            <Text variant="caption" color={palette.stoneMuted}>
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
              <Text variant="caption" color={palette.stoneFaint}>
                ml
              </Text>
            </Touchable>
          ))}
        </View>

        <SectionHeader title="Logged today" />

        {data.items.length === 0 ? (
          <EmptyState
            icon={<Droplets size={26} color={palette.white} strokeWidth={1.6} />}
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
                <Text variant="caption" color={palette.stoneMuted}>
                  {time.format(new Date(entry.loggedAt))}
                </Text>
                <Touchable
                  onPress={() => remove.mutate(entry._id)}
                  style={styles.delete}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${entry.amountMl} millilitres logged at ${time.format(new Date(entry.loggedAt))}`}
                >
                  <Trash2 size={16} color={palette.stoneFaint} strokeWidth={1.7} />
                </Touchable>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
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
    borderColor: palette.surfaceDim,
    backgroundColor: palette.sand,
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
