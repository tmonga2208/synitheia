import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createHabitSchema,
  logHabitSchema,
  objectIdSchema,
  updateHabitSchema,
} from '@synitheia/shared';
import * as service from './service.js';

export async function registerHabitRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    '/habits',
    {
      onRequest: [app.requireAuth],
      schema: {
        querystring: z.object({
          includeArchived: z.coerce.boolean().default(false),
        }),
      },
    },
    async (req) => {
      const items = await service.listHabits(req.user.id, req.query.includeArchived);
      return { items };
    },
  );

  api.post(
    '/habits',
    {
      onRequest: [app.requireAuth],
      schema: { body: createHabitSchema },
    },
    async (req, reply) => {
      const habit = await service.createHabit(req.user, req.body);
      return reply.status(201).send({ habit });
    },
  );

  api.patch(
    '/habits/:id',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: updateHabitSchema,
      },
    },
    async (req) => {
      // The whole user, not just the id: changing targetCount or frequency redefines
      // what "complete" means, and the streak recompute needs their timezone.
      const habit = await service.updateHabit(req.user, req.params.id, req.body);
      return { habit };
    },
  );

  api.delete(
    '/habits/:id',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req, reply) => {
      await service.archiveHabit(req.user, req.params.id);
      return reply.status(204).send();
    },
  );

  api.post(
    '/habits/:id/log',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: logHabitSchema,
      },
    },
    async (req) => service.logHabit(req.user, req.params.id, req.body),
  );

  api.get(
    '/habits/:id/history',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        querystring: z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }),
      },
    },
    async (req) => service.historyFor(req.user, req.params.id, req.query.days),
  );
}
