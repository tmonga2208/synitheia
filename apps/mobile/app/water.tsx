import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBackOrHome } from '../src/navigation/goBackOrHome.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Droplets, Trash2 } from 'lucide-react-native';
import { WATER_PRESETS_ML, formatVolume, type TodayResponse } from '@synitheia/shared';
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
import { WeekStrip } from '../src/components/WeekStrip.js';
import { summarizeWeek, weekOf } from '../src/today/week.js';
import { api, isQueued } from '../src/api/client.js';
import { deferWithUndo } from '../src/feedback/undo.js';
import { useAddWater } from '../src/water/useAddWater.js';
import {
  WATER_KEY,
  hideGlass,
  putGlassBack,
  refetchWater,
  type WaterResponse,
  type WireWaterEntry,
} from '../src/water/waterCache.js';
import { useAuth } from '../src/store/auth.js';
import { radius, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../src/theme/theme.js';

const ACCENT_COLOR = '#8A9AA9';

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

  // The week comes from Today's load, which every screen shares; nothing extra is fetched.
  const todayQuery = useQuery({
    queryKey: ['today'],
    queryFn: () => api.get<TodayResponse>('/today'),
  });

  // A glass shows at once, here and on Today, with or without a connection.
  const addWater = useAddWater();

  /**
   * One tap on the bin removes the entry from the screen and offers Undo; the server is
   * told only once the offer has gone (src/feedback/undo.ts), or, offline, on the way back.
   */
  function removeEntry(entry: WireWaterEntry) {
    let index = 0;

    deferWithUndo({
      message: `Removed ${formatVolume(entry.amountMl)}`,
      failed: 'Couldn’t remove that entry',
      apply: () => {
        index = hideGlass(queryClient, entry);
      },
      revert: () => putGlassBack(queryClient, entry, index),
      commit: () =>
        api.offline
          .delete<void>(
            `/water/${entry._id}`,
            undefined,
            `Removing ${formatVolume(entry.amountMl)} of water`,
          )
          .then((result) => {
            if (!isQueued(result)) refetchWater(queryClient);
          }),
    });
  }

  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });

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
            message="Could not load your water."
            onRetry={() => void refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const percent = (data.totalMl / data.targetMl) * 100;
  const week = weekOf(todayQuery.data, (d) => d.waterMl, data.totalMl);
  const summary = week ? summarizeWeek(week, data.targetMl) : null;

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
          Today
        </Text>
        <Text variant="title">Water</Text>

        <View style={styles.ring}>
          <ProgressRing percent={percent} color={ACCENT.base} size={168} strokeWidth={22}>
            <Text variant="title">{formatVolume(data.totalMl)}</Text>
            <Text variant="caption" color={t.textMuted}>
              of {formatVolume(data.targetMl)}
            </Text>
          </ProgressRing>
        </View>

        <View style={styles.presets}>
          {WATER_PRESETS_ML.map((ml) => (
            <Touchable
              key={ml}
              style={styles.preset}
              onPress={() => addWater(ml)}
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

        {week && summary ? (
          <Card style={styles.week}>
            <View style={styles.weekHeader}>
              <Text variant="label">Last 7 days</Text>
              <Text variant="caption" color={t.textMuted}>
                {[
                  summary.usual != null
                    ? `Usually ${formatVolume(Math.round(summary.usual / 100) * 100)}`
                    : null,
                  `goal met ${summary.met} of 7`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <WeekStrip
              days={week}
              target={data.targetMl}
              color={ACCENT.base}
              format={(ml) => (ml >= 1000 ? `${(ml / 1000).toFixed(1)}` : `${ml}`)}
              describe={(ml) => formatVolume(ml)}
            />
          </Card>
        ) : null}

        <SectionHeader title="Logged today" />

        {data.items.length === 0 ? (
          <EmptyState
            icon={<Droplets size={26} color={t.onAccent} strokeWidth={1.6} />}
            title="Nothing yet"
            body="Tap a glass above to log your first water of the day."
          />
        ) : (
          <Card padded={false}>
            {data.items.map((entry, index) => (
              <View
                key={entry._id}
                style={[styles.entryRow, index > 0 && styles.divider]}
              >
                <View style={[styles.dot, { backgroundColor: ACCENT.base }]} />
                <Text variant="bodyMedium" style={{ flex: 1 }}>
                  {formatVolume(entry.amountMl)}
                </Text>
                <Text variant="caption" color={t.textMuted}>
                  {time.format(new Date(entry.loggedAt))}
                </Text>
                <Touchable
                  onPress={() => removeEntry(entry)}
                  style={styles.delete}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${entry.amountMl} millilitres logged at ${time.format(new Date(entry.loggedAt))}`}
                >
                  <Trash2 size={16} color={t.textFaint} strokeWidth={1.7} />
                </Touchable>
              </View>
            ))}
          </Card>
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
    ring: { alignItems: 'center', marginVertical: spacing.lg },
    presets: {
      flexDirection: 'row',
      gap: spacing.md,
      marginBottom: spacing.lg,
    },
    week: { marginBottom: spacing.lg, gap: spacing.base },
    weekHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
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
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.xs,
      paddingLeft: spacing.lg,
      paddingRight: spacing.sm,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
    },
    dot: { width: 8, height: 8, borderRadius: radius.full },
    delete: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
