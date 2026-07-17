import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Info, Sparkles } from 'lucide-react-native';
import {
  asMinor,
  formatMoney,
  type InsightFeedback,
  type InsightSeverity,
  type SupportingMetric,
} from '@synitheia/shared';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { Skeleton, SkeletonList } from '../src/components/Skeleton.js';
import { ApiError, api } from '../src/api/client.js';
import type {
  InsightAvailability,
  InsightEvidence,
  ListResponse,
  WireInsight,
} from '../src/api/types.js';
import { useAuth } from '../src/store/auth.js';
import { MIN_TAP_TARGET, palette, radius, spacing } from '../src/theme/tokens.js';

const AVAILABILITY_KEY = ['insights', 'availability'] as const;
const INSIGHTS_KEY = ['insights'] as const;

/** The accent stripe. Attention is not alarm — this app never shouts at anyone. */
const SEVERITY_COLOR: Record<InsightSeverity, string> = {
  info: palette.sageSoft,
  notable: palette.sage,
  attention: palette.warning,
};

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  info: 'Observation',
  notable: 'Worth noticing',
  attention: 'Worth acting on',
};

function formatMetric(metric: SupportingMetric, currency: string): string {
  switch (metric.unit) {
    case 'minor_currency':
      return formatMoney(asMinor(Math.round(metric.value)), currency);
    case 'ml':
      return `${Math.round(metric.value)} ml`;
    case 'kcal':
      return `${Math.round(metric.value)} kcal`;
    case 'percent':
      return `${Math.round(metric.value)}%`;
    case 'minutes':
      return `${Math.round(metric.value)} min`;
    case 'ratio':
      return `${metric.value.toFixed(2)}×`;
    case 'count':
      return String(Math.round(metric.value));
  }
}

export default function Insights() {
  const user = useAuth((s) => s.user);
  const currency = user?.currency ?? 'INR';
  const queryClient = useQueryClient();

  const [generateError, setGenerateError] = useState<string | null>(null);

  const availability = useQuery({
    queryKey: AVAILABILITY_KEY,
    queryFn: () => api.get<InsightAvailability>('/insights/availability'),
  });

  const ready = availability.data?.configured === true && availability.data.enabled;

  const insights = useQuery({
    queryKey: INSIGHTS_KEY,
    queryFn: () => api.get<ListResponse<WireInsight>>('/insights'),
    // Never even ask for insights until we know the user opted in. The consent check
    // is a precondition of the request, not a filter applied to its response.
    enabled: ready,
  });

  /**
   * The server refuses to generate from thin data — under five days of history it
   * returns a bad_request saying so, rather than inventing a pattern that isn't there.
   * That refusal is a feature, so it is surfaced in the server's own words instead of
   * being flattened into "Something went wrong".
   */
  const generate = useMutation({
    mutationFn: () => api.post<{ generated: number }>('/insights/generate', { days: 30 }),

    onMutate: () => setGenerateError(null),

    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: INSIGHTS_KEY });
      if (result.generated === 0) {
        setGenerateError(
          'Nothing new stood out in the last 30 days. That is a fine result — it means your patterns are steady.',
        );
      }
    },

    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setGenerateError(error.message);
        // The user may have revoked consent on another device.
        if (error.code === 'ai_disabled') {
          void queryClient.invalidateQueries({ queryKey: AVAILABILITY_KEY });
        }
        return;
      }
      setGenerateError('Could not reach Synítheia right now. Please try again.');
    },
  });

  const feedback = useMutation({
    mutationFn: ({ id, value }: { id: string; value: InsightFeedback }) =>
      api.post<unknown>(`/insights/${id}/feedback`, { feedback: value }),

    onMutate: async ({ id, value }) => {
      await queryClient.cancelQueries({ queryKey: INSIGHTS_KEY });
      const previous = queryClient.getQueryData<ListResponse<WireInsight>>(INSIGHTS_KEY);

      queryClient.setQueryData<ListResponse<WireInsight>>(INSIGHTS_KEY, (current) =>
        current
          ? {
              items: current.items.map((i) =>
                i._id === id ? { ...i, userFeedback: value } : i,
              ),
            }
          : current,
      );

      return { previous };
    },

    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(INSIGHTS_KEY, context.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: INSIGHTS_KEY }),
  });

  const dismiss = useMutation({
    mutationFn: (id: string) =>
      api.post<unknown>(`/insights/${id}/status`, { status: 'dismissed' }),

    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: INSIGHTS_KEY });
      const previous = queryClient.getQueryData<ListResponse<WireInsight>>(INSIGHTS_KEY);

      // It leaves the moment they dismiss it. Waiting on the server to agree makes the
      // app feel like it did not hear them.
      queryClient.setQueryData<ListResponse<WireInsight>>(INSIGHTS_KEY, (current) =>
        current ? { items: current.items.filter((i) => i._id !== id) } : current,
      );

      return { previous };
    },

    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(INSIGHTS_KEY, context.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: INSIGHTS_KEY }),
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

  const header = (
    <View style={styles.header}>
      <Text variant="overline" color={palette.stoneFaint}>
        Synítheia AI
      </Text>
      <Text variant="title">Insights</Text>
    </View>
  );

  if (availability.isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <SkeletonList />
      </SafeAreaView>
    );
  }

  if (availability.error || !availability.data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          {header}
          <ErrorState
            message={
              availability.error instanceof Error
                ? availability.error.message
                : 'We could not reach Synítheia.'
            }
            onRetry={() => void availability.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  /**
   * AI is opt-in, and nothing on this screen may quietly opt anyone in. The CTA routes
   * to Connected Context — where the decision is made deliberately, alongside what data
   * it would be allowed to read — rather than flipping a switch from here.
   */
  if (!ready) {
    const notConfigured = !availability.data.configured;

    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {back}
          {header}

          <EmptyState
            icon={<Sparkles size={30} color={palette.white} strokeWidth={1.5} />}
            title={notConfigured ? 'Synítheia is unavailable' : 'Synítheia is off'}
            body={
              notConfigured
                ? 'This build has no AI provider configured, so no insights can be generated. Nothing you do here will change that — and nothing of yours has been sent anywhere.'
                : 'Synítheia can look across your habits, spending, food, and water to notice patterns you would not. It is off until you say otherwise, and you choose exactly which sources it may read.'
            }
            actionLabel={notConfigured ? undefined : 'Review Connected Context'}
            onAction={notConfigured ? undefined : () => router.push('/privacy')}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const items = insights.data?.items ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={insights.isRefetching}
            onRefresh={() => void insights.refetch()}
            tintColor={palette.sage}
          />
        }
      >
        {back}
        {header}

        {insights.isPending ? (
          <SkeletonList rows={3} />
        ) : insights.error ? (
          <ErrorState
            message={
              insights.error instanceof Error
                ? insights.error.message
                : 'We could not load your insights.'
            }
            onRetry={() => void insights.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={30} color={palette.white} strokeWidth={1.5} />}
            title="No insights yet"
            body="Synítheia only speaks when it has something to say. Generate a pass over the last 30 days and see what it finds."
          />
        ) : (
          <View style={styles.list}>
            {items.map((insight) => (
              <InsightCard
                key={insight._id}
                insight={insight}
                currency={currency}
                onFeedback={(value) => feedback.mutate({ id: insight._id, value })}
                onDismiss={() => dismiss.mutate(insight._id)}
              />
            ))}
          </View>
        )}

        {generateError ? (
          <Card style={styles.notice} accessibilityLiveRegion="polite">
            <Text variant="body" color={palette.stoneMuted}>
              {generateError}
            </Text>
          </Card>
        ) : null}

        <Button
          label="Generate insights"
          variant="secondary"
          loading={generate.isPending}
          onPress={() => generate.mutate()}
          style={styles.generate}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const FEEDBACK_OPTIONS: readonly { value: InsightFeedback; label: string }[] = [
  { value: 'helpful', label: 'Helpful' },
  { value: 'not_helpful', label: 'Not helpful' },
  { value: 'incorrect', label: 'Incorrect' },
];

function InsightCard({
  insight,
  currency,
  onFeedback,
  onDismiss,
}: {
  insight: WireInsight;
  currency: string;
  onFeedback: (value: InsightFeedback) => void;
  onDismiss: () => void;
}) {
  const [explained, setExplained] = useState(false);

  /**
   * The evidence is FETCHED, not regenerated: the endpoint returns the exact metrics
   * that were stored when the insight was made — the numbers the model was actually
   * shown. A second model call would produce a plausible rationale, which is not the
   * same thing as the reason, and the user would have no way to tell the difference.
   */
  const evidence = useQuery({
    queryKey: ['insights', insight._id, 'evidence'],
    queryFn: () => api.get<InsightEvidence>(`/insights/${insight._id}/evidence`),
    enabled: explained,
  });

  const accent = SEVERITY_COLOR[insight.severity];

  return (
    <Card style={styles.insight}>
      <View style={[styles.stripe, { backgroundColor: accent }]} />

      <View style={styles.severityRow}>
        <View style={[styles.severityTag, { borderColor: accent }]}>
          <Text variant="caption" color={palette.stoneMuted}>
            {SEVERITY_LABEL[insight.severity]}
          </Text>
        </View>
      </View>

      <Text variant="cardTitle">{insight.title}</Text>
      <Text variant="body" color={palette.stoneMuted}>
        {insight.description}
      </Text>

      <Touchable
        accessibilityRole="button"
        accessibilityLabel="Why am I seeing this?"
        accessibilityState={{ expanded: explained }}
        haptic={false}
        onPress={() => setExplained((open) => !open)}
        style={styles.whyRow}
      >
        <Info size={14} color={palette.stoneFaint} strokeWidth={1.8} />
        <Text variant="label" color={palette.stoneMuted}>
          Why am I seeing this?
        </Text>
      </Touchable>

      {explained ? (
        <View style={styles.evidence} accessibilityLiveRegion="polite">
          {evidence.isPending ? (
            <View style={{ gap: spacing.sm }}>
              <Skeleton width="90%" height={11} />
              <Skeleton width="65%" height={11} />
            </View>
          ) : evidence.error || !evidence.data ? (
            <Text variant="caption" color={palette.danger}>
              {evidence.error instanceof Error
                ? evidence.error.message
                : 'We could not load the evidence for this insight.'}
            </Text>
          ) : (
            <>
              <Text variant="caption" color={palette.stoneMuted}>
                {evidence.data.summary}
              </Text>

              {evidence.data.metrics.map((metric) => (
                <View key={metric.key} style={styles.metricRow}>
                  <Text variant="caption" color={palette.stoneFaint} style={styles.metricLabel}>
                    {metric.label}
                  </Text>
                  <Text variant="caption" color={palette.stone}>
                    {formatMetric(metric, currency)}
                    {metric.comparisonValue !== null && metric.comparisonLabel !== null
                      ? ` vs ${formatMetric(
                          { ...metric, value: metric.comparisonValue },
                          currency,
                        )} ${metric.comparisonLabel}`
                      : ''}
                  </Text>
                </View>
              ))}

              <Text variant="caption" color={palette.stoneFaint}>
                {`${evidence.data.period.start} → ${evidence.data.period.end} · ${Math.round(
                  evidence.data.confidence * 100,
                )}% confidence`}
              </Text>
            </>
          )}
        </View>
      ) : null}

      <View style={styles.feedbackRow}>
        {FEEDBACK_OPTIONS.map(({ value, label }) => (
          <Chip
            key={value}
            label={label}
            selected={insight.userFeedback === value}
            accessibilityLabel={`Mark this insight as ${label.toLowerCase()}`}
            onPress={() => onFeedback(value)}
          />
        ))}
      </View>

      <Touchable
        accessibilityRole="button"
        accessibilityLabel="Dismiss this insight"
        haptic={false}
        onPress={onDismiss}
        style={styles.dismiss}
      >
        <Text variant="label" color={palette.stoneFaint}>
          Dismiss
        </Text>
      </Touchable>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.md,
  },
  header: {
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  list: { gap: spacing.base },
  insight: {
    gap: spacing.sm,
    overflow: 'hidden',
  },
  stripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: spacing.xs,
  },
  severityRow: { flexDirection: 'row' },
  severityTag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    backgroundColor: palette.sand,
  },
  whyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TAP_TARGET,
  },
  evidence: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.surfaceDim,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  metricLabel: { flexShrink: 1 },
  feedbackRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  dismiss: {
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  notice: {
    marginTop: spacing.lg,
    backgroundColor: palette.sand,
  },
  generate: { marginTop: spacing.xl },
});
