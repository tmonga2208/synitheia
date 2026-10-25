import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import { registerAuthRoutes } from './routes.js';
import { signup } from './service.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});

const BASE_ENV = {
  JWT_SECRET: 'q7Lm2Zp9Vx4Rt8Wn3Ks6Bd1Hf5Jc0Ga9',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL_DAYS: 30,
  GOOGLE_CLIENT_IDS: [],
} as unknown as Env;

async function appWith(env: Env) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('requireAuth', async (_req: FastifyRequest) => undefined);
  await registerAuthRoutes(app, env);
  return app;
}

const MAILING = { ...BASE_ENV, RESEND_API_KEY: 're_test', MAIL_FROM: 'Synítheia <hello@example.com>' } as Env;

describe('password reset routes', () => {
  it('say there is no password reset when email is not set up', async () => {
    const app = await appWith(BASE_ENV);

    const options = await app.inject({ method: 'GET', url: '/auth/options' });
    expect(options.json()).toEqual({ passwordReset: false });

    const asked = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'reader@example.com' },
    });
    expect(asked.statusCode).toBe(503);
  });

  it('send a code, then sign in with the new password', async () => {
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(String(init.body));
        return new Response('{"id":"m1"}', { status: 200 });
      }),
    );
    await signup({
      email: 'reader@example.com',
      password: 'old-password-123',
      name: 'Reader',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });
    const app = await appWith(MAILING);

    expect((await app.inject({ method: 'GET', url: '/auth/options' })).json()).toEqual({
      passwordReset: true,
    });

    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'nobody@example.com' },
    });
    const known = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'reader@example.com' },
    });
    // The same answer for both: the route does not say which addresses have accounts.
    expect([unknown.statusCode, known.statusCode]).toEqual([202, 202]);
    expect(unknown.json()).toEqual(known.json());
    expect(sent).toHaveLength(1);

    const code = /\b(\d{6})\b/.exec(JSON.parse(sent[0]!).text)![1];
    const confirmed = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { email: 'reader@example.com', code, password: 'new-password-456' },
    });

    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ user: { email: 'reader@example.com' } });
    expect(typeof confirmed.json().accessToken).toBe('string');
    expect(typeof confirmed.json().refreshToken).toBe('string');
  });
});
