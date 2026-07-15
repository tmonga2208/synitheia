import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { syncWeatherSchema } from '@synitheia/shared';
import * as service from './service.js';

export async function registerWeatherRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Report the phone's approximate position; the server looks up the weather there.
   *
   * The provider stays server-side (no key in the app), and only a rounded coordinate ever
   * leaves the device. Requires Weather to be switched on in Connected Context — the service
   * re-checks that consent before it looks anything up.
   */
  api.post(
    '/weather/sync',
    { onRequest: [app.requireAuth], schema: { body: syncWeatherSchema } },
    async (req) => service.sync(req.user, req.body),
  );
}
