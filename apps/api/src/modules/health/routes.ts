import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { bodyMetricsSchema, calorieGoalSchema, syncHealthSchema } from '@synitheia/shared';
import * as service from './service.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Push a batch of local days read from Apple Health.
   *
   * The client is the only thing that can read HealthKit — the data never leaves the device
   * except through this call, and only once the user has switched Health on in Connected
   * Context. The service re-checks that consent; the client asking nicely is not enough.
   */
  api.post(
    '/health/sync',
    { onRequest: [app.requireAuth], schema: { body: syncHealthSchema } },
    async (req) => service.sync(req.user, req.body),
  );

  /** BMI, BMR, TDEE, and what a calorie target WOULD be for each goal. Applies nothing. */
  api.get('/health/body', { onRequest: [app.requireAuth] }, async (req) =>
    service.bodyReport(req.user),
  );

  /** Whatever Health did not hold — typically height, sex, or date of birth. */
  api.patch(
    '/health/body',
    { onRequest: [app.requireAuth], schema: { body: bodyMetricsSchema.partial() } },
    async (req) => service.updateBody(req.user, req.body),
  );

  /**
   * The CONFIRM step: the user picks a goal, and only now is a calorie target written.
   * Nothing else in this module ever touches `calorieTarget`.
   */
  api.put(
    '/health/calorie-goal',
    {
      onRequest: [app.requireAuth],
      schema: { body: z.object({ goal: calorieGoalSchema }) },
    },
    async (req) => service.setCalorieGoal(req.user, req.body.goal),
  );
}
