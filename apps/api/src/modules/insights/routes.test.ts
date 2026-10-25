import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DataSourceConnectionModel, UserPreferenceModel } from '../../db/models.js';
import type { Env } from '../../config/env.js';
import { registerInsightRoutes } from './routes.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});

async function appFor(userId: Types.ObjectId) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    req.user = { id: userId.toString(), timezone: 'Asia/Kolkata', currency: 'INR' };
  });
  // No model key: availability must still answer, and generation is not under test.
  await registerInsightRoutes(app, {} as Env);
  return app;
}

describe('GET /insights/availability', () => {
  it('lists the sources whose AI switch is on, as the context builder reads them', async () => {
    const userId = new Types.ObjectId();
    await DataSourceConnectionModel.create([
      { userId, source: 'health', status: 'connected', aiAllowed: true },
      { userId, source: 'calendar', status: 'connected', aiAllowed: false },
    ]);
    // A stale copy on the preferences, the way accounts were left before the switches
    // became the only record: calendar still listed after its AI switch went off.
    await UserPreferenceModel.collection.insertOne({
      userId,
      aiEnabled: true,
      aiAllowedSources: ['calendar'],
    });

    const app = await appFor(userId);
    const response = await app.inject({ method: 'GET', url: '/insights/availability' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      configured: false,
      enabled: true,
      allowedSources: ['health'],
    });
  });
});
