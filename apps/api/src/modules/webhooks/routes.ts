import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../core/errors.js';
import type { Env } from '../../config/env.js';
import { handleInboundEmail, type InboundEmailPayload } from './email.js';

function secretOk(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function registerWebhookRoutes(app: FastifyInstance, env: Env): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  const attachmentSchema = z.object({
    filename: z.string().optional(),
    contentType: z.string().optional(),
    contentBase64: z.string().optional(),
  });

  api.post(
    '/webhooks/email',
    {
      // The inbound provider is not a browser and must not share the per-user budget.
      config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          to: z.string().optional(),
          from: z.string().optional(),
          subject: z.string().optional(),
          text: z.string().optional(),
          html: z.string().optional(),
          messageId: z.string().optional(),
          attachments: z.array(attachmentSchema).optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!env.INBOUND_WEBHOOK_SECRET || !secretOk(req.headers.authorization, env.INBOUND_WEBHOOK_SECRET)) {
        throw AppError.unauthorized('Invalid webhook credentials');
      }
      // Resolve, parse, and file. Every not-for-us / empty case resolves 200 inside.
      await handleInboundEmail(env, req.body as InboundEmailPayload);
      return reply.status(200).send({ ok: true });
    },
  );
}
