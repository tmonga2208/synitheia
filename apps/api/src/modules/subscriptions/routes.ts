import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createSubscriptionSchema,
  objectIdSchema,
  updateSubscriptionSchema,
} from '@synitheia/shared';
import * as service from './service.js';

export async function registerSubscriptionRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    '/subscriptions',
    {
      onRequest: [app.requireAuth],
      schema: {
        querystring: z.object({
          includeArchived: z.coerce.boolean().default(false),
        }),
      },
    },
    async (req) => {
      const [items, summary] = await Promise.all([
        service.listSubscriptions(req.user.id, req.query.includeArchived),
        service.summarize(req.user.id),
      ]);

      return { items, ...summary };
    },
  );

  api.post(
    '/subscriptions',
    {
      onRequest: [app.requireAuth],
      schema: { body: createSubscriptionSchema },
    },
    async (req, reply) => {
      const subscription = await service.createSubscription(req.user, req.body);
      return reply.status(201).send({ subscription });
    },
  );

  api.patch(
    '/subscriptions/:id',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: updateSubscriptionSchema,
      },
    },
    async (req) => ({
      subscription: await service.updateSubscription(req.user, req.params.id, req.body),
    }),
  );

  api.delete(
    '/subscriptions/:id',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req, reply) => {
      await service.archiveSubscription(req.user.id, req.params.id);
      return reply.status(204).send();
    },
  );
}
