import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { syncCalendarSchema } from '@synitheia/shared';
import * as service from './service.js';

export async function registerCalendarRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Push a window of calendar events read on the device.
   *
   * Only the client can read the device calendar, and only once the user has switched
   * Calendar on in Connected Context. The service re-checks that consent — the client
   * asking nicely is not enough — and mirrors the events onto the timeline read-only.
   */
  api.post(
    '/calendar/sync',
    { onRequest: [app.requireAuth], schema: { body: syncCalendarSchema } },
    async (req) => service.sync(req.user, req.body),
  );
}
