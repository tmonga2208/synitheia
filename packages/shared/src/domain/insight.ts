import { z } from 'zod';
import {
  confidenceSchema,
  isoInstantSchema,
  localDateSchema,
  objectIdSchema,
} from './common.js';

export const insightTypeSchema = z.enum([
  'spending_pattern',
  'habit_pattern',
  'nutrition_pattern',
  'hydration_pattern',
  'activity_pattern',
  'cross_domain', //  e.g. "you skip workouts on days with late meetings"
  'anomaly',
]);
export type InsightType = z.infer<typeof insightTypeSchema>;

export const insightSeveritySchema = z.enum(['info', 'notable', 'attention']);
export type InsightSeverity = z.infer<typeof insightSeveritySchema>;

export const insightStatusSchema = z.enum(['active', 'dismissed', 'accepted', 'expired']);
export type InsightStatus = z.infer<typeof insightStatusSchema>;

export const insightFeedbackSchema = z.enum(['helpful', 'not_helpful', 'incorrect']);
export type InsightFeedback = z.infer<typeof insightFeedbackSchema>;

/**
 * A single number the model was given, kept verbatim.
 *
 * These are computed in application code BEFORE the model is called, and stored
 * alongside the insight afterwards. Two consequences, both deliberate:
 *
 *  1. The model never does arithmetic. It interprets numbers we already trust.
 *     Asking an LLM to total 18 expenses is asking it to be wrong occasionally.
 *  2. "Why am I seeing this?" renders from these stored values — not from a second
 *     model call. The explanation is the actual evidence, not a plausible-sounding
 *     reconstruction of it.
 *
 * An insight that cites a metric not present here is rejected at validation time
 * and never shown. That is the guard against fabrication.
 */
export const supportingMetricSchema = z.object({
  key: z.string(), //  'food_spend_friday_avg'
  label: z.string(), //  'Average Friday food spend'
  value: z.number(),
  unit: z.enum(['minor_currency', 'ml', 'kcal', 'count', 'percent', 'minutes', 'ratio']),

  /**
   * The value as a human should read it — "₹960", "1.8 L", "86%".
   *
   * Formatted in code, and the ONLY form the model is allowed to quote in prose. Money
   * is stored in minor units (paise), and a model handed `96000` will faithfully write
   * "you spend 96000 on Fridays" — which is both wrong and unreadable. Formatting is a
   * deterministic problem; handing it to an LLM is how you get ₹96,000 lunches.
   */
  displayValue: z.string(),
  comparisonDisplayValue: z.string().nullable(),
  /** The comparison baseline, when the insight is a comparison. */
  comparisonValue: z.number().nullable(),
  comparisonLabel: z.string().nullable(),
});
export type SupportingMetric = z.infer<typeof supportingMetricSchema>;

export const aiInsightSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,

  type: insightTypeSchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  severity: insightSeveritySchema,
  confidence: confidenceSchema,

  supportingMetrics: z.array(supportingMetricSchema).min(1),
  supportingEventIds: z.array(objectIdSchema),
  /** Plain-language provenance: "Based on 18 expense events across the last 4 Fridays." */
  evidenceSummary: z.string(),

  periodStart: localDateSchema,
  periodEnd: localDateSchema,

  generatedAt: isoInstantSchema,
  /** Insights go stale. A note about last week's water is irrelevant a fortnight later. */
  expiresAt: isoInstantSchema,

  status: insightStatusSchema,
  userFeedback: insightFeedbackSchema.nullable(),
  feedbackAt: isoInstantSchema.nullable(),
});
export type AIInsight = z.infer<typeof aiInsightSchema>;

/**
 * What the model is required to return. Anything failing this schema is dropped
 * rather than repaired — a malformed insight is a signal the model is off the rails,
 * and shipping a half-parsed one to a user is worse than shipping none.
 */
export const generatedInsightSchema = z.object({
  type: insightTypeSchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  severity: insightSeveritySchema,
  confidence: confidenceSchema,
  /** Must reference keys that exist in the context we supplied. Enforced, not requested. */
  metricKeys: z.array(z.string()).min(1),
  evidenceSummary: z.string().min(1).max(200),
});
export type GeneratedInsight = z.infer<typeof generatedInsightSchema>;

export const insightFeedbackInputSchema = z.object({
  feedback: insightFeedbackSchema,
});

export const insightStatusInputSchema = z.object({
  status: z.enum(['dismissed', 'accepted']),
});
