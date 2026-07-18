import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import {
  serializerCompiler,
  validatorCompiler,
  hasZodFastifySchemaValidationErrors,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { AppError, type ErrorResponseBody } from './core/errors.js';
import { authGuard } from './core/auth-guard.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerExpenseRoutes } from './modules/expenses/routes.js';
import { registerHabitRoutes } from './modules/habits/routes.js';
import { registerNutritionRoutes } from './modules/nutrition/routes.js';
import { registerWaterRoutes } from './modules/water/routes.js';
import { registerReminderRoutes } from './modules/reminders/routes.js';
import { registerTodayRoutes } from './modules/today/routes.js';
import { registerInsightRoutes } from './modules/insights/routes.js';
import { registerInferenceRoutes } from './modules/inference/routes.js';
import { registerSubscriptionRoutes } from './modules/subscriptions/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerCalendarRoutes } from './modules/calendar/routes.js';
import { registerWeatherRoutes } from './modules/weather/routes.js';
import { registerLocationRoutes } from './modules/location/routes.js';
import { registerPrivacyRoutes } from './modules/privacy/routes.js';
import { registerWebhookRoutes } from './modules/webhooks/routes.js';
import type { Env } from './config/env.js';

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      /**
       * Redaction is not optional here. This service handles health, financial, and
       * location data; a log line containing a bearer token or a password is a breach
       * waiting for someone to grep for it. Redact at the logger, not at each call
       * site, because call sites are where people forget.
       */
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.idToken',
          'req.body.refreshToken',
        ],
        censor: '[redacted]',
      },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
          : undefined,
    },
    genReqId: () => crypto.randomUUID(),
    /** Screenshots and PDF statements. Anything larger is not a receipt. */
    bodyLimit: 10 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    // Rate-limit per account when we know it, per IP otherwise. Keying purely on IP
    // would let one user behind a corporate NAT exhaust the budget for everyone there.
    keyGenerator: (req) => req.user?.id ?? req.ip,
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  await app.register(authGuard, { env });

  /**
   * The single place HTTP status codes are decided.
   *
   * Anything that is not an AppError or a validation failure is, by definition, a bug
   * we did not anticipate. It is logged with its stack and returned as a bare 500 —
   * the client learns nothing about our internals, and we learn everything.
   */
  app.setErrorHandler((error, req, reply) => {
    const requestId = req.id;

    if (hasZodFastifySchemaValidationErrors(error)) {
      const body: ErrorResponseBody = {
        error: {
          code: 'validation_failed',
          message: 'Request validation failed',
          details: error.validation,
          requestId,
        },
      };
      return reply.status(422).send(body);
    }

    if (error instanceof AppError) {
      // Expected failures are not errors in the operational sense — a 404 is a normal
      // day. Logging them at error level trains everyone to ignore the error log.
      req.log.info({ code: error.code, msg: error.message }, 'handled app error');
      const body: ErrorResponseBody = {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      };
      return reply.status(error.status).send(body);
    }

    if (error instanceof ZodError) {
      const body: ErrorResponseBody = {
        error: {
          code: 'validation_failed',
          message: 'Response failed validation',
          details: error.issues,
          requestId,
        },
      };
      return reply.status(500).send(body);
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      const body: ErrorResponseBody = {
        error: { code: 'rate_limited', message: 'Too many requests', requestId },
      };
      return reply.status(429).send(body);
    }

    req.log.error({ err: error }, 'unhandled error');
    const body: ErrorResponseBody = {
      error: {
        code: 'internal',
        message: 'Something went wrong',
        requestId,
      },
    };
    return reply.status(500).send(body);
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      await registerAuthRoutes(api, env);
      await registerExpenseRoutes(api);
      await registerHabitRoutes(api);
      await registerNutritionRoutes(api);
      await registerWaterRoutes(api);
      await registerReminderRoutes(api);
      await registerTodayRoutes(api);
      await registerInsightRoutes(api, env);
      await registerInferenceRoutes(api);
      await registerSubscriptionRoutes(api);
      await registerHealthRoutes(api);
      await registerCalendarRoutes(api);
      await registerWeatherRoutes(api);
      await registerLocationRoutes(api);
      await registerPrivacyRoutes(api);
      await registerWebhookRoutes(api, env);
    },
    { prefix: '/v1' },
  );

  return app;
}
