import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExpenseCategoryModel, ExpenseIngestionModel, ExpenseModel, UserModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import type * as Env from '../../config/env.js';
import { registerExpenseRoutes } from './routes.js';

// The expense routes read the environment once, for AI and storage keys not used here.
vi.mock('../../config/env.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Env>()),
  loadEnv: () => ({}),
}));

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

async function setup(amounts: number[]): Promise<{
  app: FastifyInstance;
  userId: Types.ObjectId;
  categoryId: string;
  ingestionId: string;
}> {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Reader',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  });
  const category = await ExpenseCategoryModel.create({
    userId: user._id,
    name: 'Food',
    icon: 'utensils',
    color: '#C08A7D',
  });
  const ingestion = await ExpenseIngestionModel.create({
    userId: user._id,
    channel: 'pdf',
    status: 'needs_review',
    drafts: amounts.map((amountMinor) => ({
      amountMinor,
      currency: 'INR',
      merchant: `Shop ${amountMinor}`,
      occurredAt: new Date('2026-10-25T06:30:00Z'),
      suggestedCategoryName: null,
      confidence: 0.9,
      evidence: null,
      duplicateOfExpenseId: null,
    })),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    req.user = { id: user._id.toString(), timezone: 'Asia/Kolkata', currency: 'INR' };
  });
  app.setErrorHandler((error, _req, reply) =>
    reply.status(error instanceof AppError ? error.status : 500).send({ message: error.message }),
  );
  await registerExpenseRoutes(app);

  return { app, userId: user._id, categoryId: category._id.toString(), ingestionId: ingestion._id.toString() };
}

describe('POST /expenses/ingestions/:id/confirm', () => {
  it('files the confirmed drafts, answering in the order they were confirmed', async () => {
    const { app, userId, categoryId, ingestionId } = await setup([100, 200, 300]);

    const res = await app.inject({
      method: 'POST',
      url: `/expenses/ingestions/${ingestionId}/confirm`,
      payload: { confirmations: [2, 0, 1].map((draftIndex) => ({ draftIndex, categoryId })) },
    });

    expect(res.statusCode).toBe(201);
    expect((res.json() as { expenses: { amountMinor: number }[] }).expenses.map((e) => e.amountMinor)).toEqual([
      300, 100, 200,
    ]);
    expect(await ExpenseModel.countDocuments({ userId })).toBe(3);
  });

  it('files an import once, even when it is confirmed twice at the same time', async () => {
    const { app, userId, categoryId, ingestionId } = await setup([100, 200]);
    const confirm = () =>
      app.inject({
        method: 'POST',
        url: `/expenses/ingestions/${ingestionId}/confirm`,
        payload: { confirmations: [0, 1].map((draftIndex) => ({ draftIndex, categoryId })) },
      });

    const statuses = (await Promise.all([confirm(), confirm()])).map((r) => r.statusCode).sort();

    expect(statuses).toEqual([201, 409]);
    expect(await ExpenseModel.countDocuments({ userId })).toBe(2);
  });

  it('refuses to confirm an import that has already been filed', async () => {
    const { app, userId, categoryId, ingestionId } = await setup([100]);
    const confirm = () =>
      app.inject({
        method: 'POST',
        url: `/expenses/ingestions/${ingestionId}/confirm`,
        payload: { confirmations: [{ draftIndex: 0, categoryId }] },
      });

    expect((await confirm()).statusCode).toBe(201);
    expect((await confirm()).statusCode).toBe(409);
    expect(await ExpenseModel.countDocuments({ userId })).toBe(1);
  });

  it('files nothing when one confirmation names a draft that is not there', async () => {
    const { app, userId, categoryId, ingestionId } = await setup([100, 200]);

    const res = await app.inject({
      method: 'POST',
      url: `/expenses/ingestions/${ingestionId}/confirm`,
      payload: { confirmations: [{ draftIndex: 0, categoryId }, { draftIndex: 7, categoryId }] },
    });

    expect(res.statusCode).toBe(400);
    expect(await ExpenseModel.countDocuments({ userId })).toBe(0);
  });
});
