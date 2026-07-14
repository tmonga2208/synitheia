import { Types } from 'mongoose';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  addLocalDays,
  insightFeedbackInputSchema,
  insightStatusInputSchema,
  objectIdSchema,
  todayLocalDate,
  type LocalDate,
} from '@synitheia/shared';
import { AIInsightModel, UserPreferenceModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import { generateInsights, getActiveInsights } from '../../ai/synitheia.js';
import { isAiConfigured, type Env } from '../../config/env.js';

export async function registerInsightRoutes(
  app: FastifyInstance,
  env: Env,
): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get('/insights', { onRequest: [app.requireAuth] }, async (req) => ({
    items: await getActiveInsights(req.user.id),
  }));

  /**
   * Generation is explicit and rate-limited, not automatic on app open.
   *
   * An LLM call on every cold start would be slow, expensive, and would reword the
   * same observation slightly differently each time — which reads as instability
   * rather than intelligence. Insights are generated, stored, and then served from
   * the store until they expire.
   */
  api.post(
    '/insights/generate',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        body: z.object({
          days: z.coerce.number().int().min(7).max(90).default(30),
        }),
      },
    },
    async (req) => {
      if (!isAiConfigured(env)) {
        throw AppError.aiUnavailable('Synítheia AI is not configured on this server');
      }

      const to = todayLocalDate(req.user.timezone);
      const from = addLocalDays(to, -(req.body.days - 1)) as LocalDate;

      // buildContext throws ai_disabled if the user has not opted in. The consent
      // check happens before any context is assembled — not after.
      const insights = await generateInsights({
        env,
        userId: req.user.id,
        timezone: req.user.timezone,
        currency: req.user.currency,
        from,
        to,
        log: req.log,
      });

      return { insights, generated: insights.length };
    },
  );

  /**
   * "Why am I seeing this?"
   *
   * Renders from the metrics we stored at generation time — the actual numbers the
   * model was shown — not from a second model call reconstructing a plausible
   * rationale. The explanation IS the evidence. If a user cannot check our reasoning,
   * they have no grounds to trust it or to correct it.
   */
  api.get(
    '/insights/:id/evidence',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req) => {
      const insight = await AIInsightModel.findOne({
        _id: new Types.ObjectId(req.params.id),
        userId: new Types.ObjectId(req.user.id),
      }).lean();

      if (!insight) throw AppError.notFound('Insight');

      return {
        summary: insight.evidenceSummary,
        period: { start: insight.periodStart, end: insight.periodEnd },
        metrics: insight.supportingMetrics,
        confidence: insight.confidence,
        generatedAt: insight.generatedAt,
      };
    },
  );

  api.post(
    '/insights/:id/feedback',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: insightFeedbackInputSchema,
      },
    },
    async (req) => {
      const insight = await AIInsightModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(req.params.id),
          userId: new Types.ObjectId(req.user.id),
        },
        { $set: { userFeedback: req.body.feedback, feedbackAt: new Date() } },
        { new: true },
      ).lean();

      if (!insight) throw AppError.notFound('Insight');
      return { insight };
    },
  );

  api.post(
    '/insights/:id/status',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: insightStatusInputSchema,
      },
    },
    async (req) => {
      const insight = await AIInsightModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(req.params.id),
          userId: new Types.ObjectId(req.user.id),
        },
        { $set: { status: req.body.status } },
        { new: true },
      ).lean();

      if (!insight) throw AppError.notFound('Insight');
      return { insight };
    },
  );

  /** Whether the feature is even available, so the client can hide it cleanly. */
  api.get('/insights/availability', { onRequest: [app.requireAuth] }, async (req) => {
    const prefs = await UserPreferenceModel.findOne({
      userId: new Types.ObjectId(req.user.id),
    }).lean();

    return {
      configured: isAiConfigured(env),
      enabled: prefs?.aiEnabled ?? false,
      allowedSources: prefs?.aiAllowedSources ?? [],
    };
  });
}
