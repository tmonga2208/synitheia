import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { syncLocationSchema } from '@synitheia/shared';
import * as service from './service.js';

export async function registerLocationRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Report places the phone recognised (foreground, best-effort).
   *
   * Only the client can read location, and only once the user has switched Location on in
   * Connected Context. The service re-checks that consent and mirrors each visit onto the
   * timeline as a coarse, labelled arrival.
   */
  api.post(
    '/location/sync',
    { onRequest: [app.requireAuth], schema: { body: syncLocationSchema } },
    async (req) => service.sync(req.user, req.body),
  );
}
