import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExpenseCategoryModel, UserModel } from '../db/models.js';
import { AppError } from '../core/errors.js';
import type * as Env from '../config/env.js';
import { registerWaterRoutes } from './water/routes.js';
import { registerNutritionRoutes } from './nutrition/routes.js';
import { registerExpenseRoutes } from './expenses/routes.js';
import { registerHabitRoutes } from './habits/routes.js';
import { registerReminderRoutes } from './reminders/routes.js';
import { registerSubscriptionRoutes } from './subscriptions/routes.js';

// Meal and expense routes read the environment once, for AI and storage keys not used here.
vi.mock('../config/env.js', async (importOriginal) => ({
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

async function setup(): Promise<{ app: FastifyInstance; categoryId: string }> {
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

  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    req.user = { id: user._id.toString(), timezone: 'Asia/Kolkata', currency: 'INR' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    return reply.status(500).send({ error: { code: 'internal', message: String(error) } });
  });

  await registerWaterRoutes(app);
  await registerNutritionRoutes(app);
  await registerExpenseRoutes(app);
  await registerHabitRoutes(app);
  await registerReminderRoutes(app);
  await registerSubscriptionRoutes(app);
  return { app, categoryId: category._id.toString() };
}

const CASES: Array<{
  name: string;
  url: string;
  body: (categoryId: string) => Record<string, unknown>;
  collection: string;
}> = [
  { name: 'a glass of water', url: '/water', body: () => ({ amountMl: 250 }), collection: 'WaterEntry' },
  {
    name: 'a meal',
    url: '/food',
    body: () => ({
      name: 'Toast',
      mealType: 'breakfast',
      macrosPerServing: { calories: 120, proteinG: 4, carbsG: 20, fatG: 2 },
    }),
    collection: 'FoodEntry',
  },
  {
    name: 'an expense',
    url: '/expenses',
    body: (categoryId) => ({ amountMinor: 32000, categoryId }),
    collection: 'Expense',
  },
  {
    name: 'a habit',
    url: '/habits',
    body: () => ({ name: 'Reading', icon: 'book-open', color: '#7D927D', frequency: 'daily' }),
    collection: 'Habit',
  },
  {
    name: 'a reminder',
    url: '/reminders',
    body: () => ({ kind: 'water', label: 'Drink water', time: '15:00' }),
    collection: 'Reminder',
  },
  {
    name: 'a bill',
    url: '/subscriptions',
    body: (categoryId) => ({ name: 'Netflix', amountMinor: 64900, categoryId, cycle: 'monthly', anchorDay: 5 }),
    collection: 'Subscription',
  },
];

/**
 * Something made offline gets its id on the phone, so it can be ticked, edited or deleted
 * before it reaches the server. The server must keep that id.
 */
describe('creating with an id chosen by the app', () => {
  for (const { name, url, body, collection } of CASES) {
    it(`keeps the id of ${name}`, async () => {
      const { app, categoryId } = await setup();
      const id = new Types.ObjectId().toString();

      const created = await app.inject({ method: 'POST', url, payload: { ...body(categoryId), id } });

      expect(created.statusCode).toBe(201);
      expect(await mongoose.models[collection]!.exists({ _id: new Types.ObjectId(id) })).toBeTruthy();
    });

    it(`refuses ${name} whose id is already taken`, async () => {
      const { app, categoryId } = await setup();
      const id = new Types.ObjectId().toString();

      await app.inject({ method: 'POST', url, payload: { ...body(categoryId), id } });
      const again = await app.inject({ method: 'POST', url, payload: { ...body(categoryId), id } });

      expect(again.statusCode).toBe(409);
    });
  }
});
