import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addLocalDays, todayLocalDate, type TodayResponse } from '@synitheia/shared';
import { ExpenseModel, UserModel, WaterEntryModel } from '../../db/models.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { registerTodayRoutes } from './routes.js';

const IST = 'Asia/Kolkata';
let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('GET /today weeklyFlow totals', () => {
  it("carries each day's water and spending, so trackers can draw a week from one request", async () => {
    const created = await UserModel.create({
      email: `${new Types.ObjectId().toString()}@example.com`,
      name: 'Week',
      timezone: IST,
      currency: 'INR',
    });
    const user: AuthedUser = { id: created._id.toString(), timezone: IST, currency: 'INR' };
    const userId = created._id;

    const today = todayLocalDate(IST);
    const yesterday = addLocalDays(today, -1);

    await WaterEntryModel.create([
      { userId, amountMl: 500, loggedAt: new Date(), timezone: IST, localDate: yesterday },
      { userId, amountMl: 250, loggedAt: new Date(), timezone: IST, localDate: yesterday },
    ]);
    await ExpenseModel.create({
      userId,
      amountMinor: 32_000,
      currency: 'INR',
      categoryId: new Types.ObjectId(),
      categoryName: 'Food',
      categoryColor: '#000000',
      occurredAt: new Date(),
      timezone: IST,
      localDate: yesterday,
      participants: [],
    });

    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('requireAuth', async (req: FastifyRequest) => {
      req.user = user;
    });
    await registerTodayRoutes(app);
    await app.ready();

    try {
      const res = await app.inject({ method: 'GET', url: '/today' });
      expect(res.statusCode).toBe(200);
      const week = res.json<TodayResponse>().weeklyFlow;

      const day = week.find((d) => d.localDate === yesterday);
      expect(day?.totals).toMatchObject({ waterMl: 750, spentMinor: 32_000, calories: 0 });

      // A day with nothing logged still has totals — zeros, not a missing field.
      expect(week.find((d) => d.isToday)?.totals).toMatchObject({ waterMl: 0, spentMinor: 0 });
    } finally {
      await app.close();
    }
  });
});
