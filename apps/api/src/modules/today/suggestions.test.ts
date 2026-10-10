import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addLocalDays, todayLocalDate } from '@synitheia/shared';
import {
  HabitLogModel,
  HabitModel,
  InferredContextModel,
  PersonalEventModel,
  UserModel,
} from '../../db/models.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { registerInferenceRoutes } from '../inference/routes.js';
import { registerTodayRoutes } from './routes.js';

/**
 * Which suggestions Today shows, and what confirming one does — through the real routes.
 *
 * The ranking and the confirm write are each unit-tested, but only a request proves the
 * handler still calls them: the same reasoning as the `/today` test in xp.test.ts, and the
 * same bare-Fastify harness, with `requireAuth` replaced by one that asserts a known user.
 */

let mongo: MongoMemoryReplSet;
const IST = 'Asia/Kolkata';
const TODAY = todayLocalDate(IST);
const YESTERDAY = addLocalDays(TODAY, -1);

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    InferredContextModel.syncIndexes(),
    PersonalEventModel.syncIndexes(),
    HabitModel.syncIndexes(),
    HabitLogModel.syncIndexes(),
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all([
    InferredContextModel.deleteMany({}),
    PersonalEventModel.deleteMany({}),
    HabitModel.deleteMany({}),
    HabitLogModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

async function seedUser(): Promise<AuthedUser> {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test User',
    timezone: IST,
    currency: 'INR',
  });
  return { id: user._id.toString(), timezone: IST, currency: 'INR' };
}

async function buildApp(user: AuthedUser) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    req.user = user;
  });
  await registerTodayRoutes(app);
  await registerInferenceRoutes(app);
  await app.ready();
  return app;
}

let serial = 0;

async function suggestion(
  user: AuthedUser,
  input: {
    title: string;
    confidence: number;
    localDate: string;
    proposed: Record<string, unknown>;
    type?: string;
  },
) {
  serial += 1;
  return InferredContextModel.create({
    userId: new Types.ObjectId(user.id),
    type: input.type ?? 'unusual_spending',
    confidence: input.confidence,
    detector: `test_detector_${serial}`,
    title: input.title,
    proposed: input.proposed,
    status: 'pending',
    localDate: input.localDate,
    // Still inside the 48-hour life, whichever day it was raised on.
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  });
}

const OBSERVATION = { kind: 'observation' };

async function titles(user: AuthedUser): Promise<string[]> {
  const app = await buildApp(user);
  try {
    const res = await app.inject({ method: 'GET', url: '/today' });
    expect(res.statusCode).toBe(200);
    return res.json<{ suggestions: { title: string }[] }>().suggestions.map((s) => s.title);
  } finally {
    await app.close();
  }
}

describe('GET /today — suggestions', () => {
  it('puts something the user can confirm ahead of a more confident observation', async () => {
    const user = await seedUser();
    await suggestion(user, {
      title: 'observation',
      confidence: 0.9,
      localDate: TODAY,
      proposed: OBSERVATION,
    });
    await suggestion(user, {
      title: 'actionable',
      confidence: 0.62,
      localDate: TODAY,
      type: 'possible_meal',
      proposed: { kind: 'food', name: 'Lunch', mealType: 'lunch', estimatedCalories: null },
    });

    expect(await titles(user)).toEqual(['actionable', 'observation']);
  });

  it("does not show yesterday's observation as if it were about today", async () => {
    // "Reading is usually done by now", raised at 10 AM yesterday, is simply false at
    // 7 AM today — but it has not reached its 48-hour expiry.
    const user = await seedUser();
    await suggestion(user, {
      title: 'stale observation',
      confidence: 0.9,
      localDate: YESTERDAY,
      proposed: OBSERVATION,
    });
    await suggestion(user, {
      title: 'today observation',
      confidence: 0.6,
      localDate: TODAY,
      proposed: OBSERVATION,
    });

    expect(await titles(user)).toEqual(['today observation']);
  });

  it("still offers yesterday's unanswered question", async () => {
    // A meal the user has not confirmed is as true this morning as it was last night.
    const user = await seedUser();
    await suggestion(user, {
      title: 'lunch yesterday',
      confidence: 0.62,
      localDate: YESTERDAY,
      type: 'possible_meal',
      proposed: { kind: 'food', name: 'Lunch', mealType: 'lunch', estimatedCalories: null },
    });

    expect(await titles(user)).toEqual(['lunch yesterday']);
  });

  it('never lets a crowd of observations push the actionable card out', async () => {
    const user = await seedUser();
    // Oldest row, lowest confidence: whichever way an unranked fetch is cut, it loses.
    await suggestion(user, {
      title: 'actionable',
      confidence: 0.6,
      localDate: TODAY,
      type: 'possible_meal',
      proposed: { kind: 'food', name: 'Lunch', mealType: 'lunch', estimatedCalories: null },
    });
    for (let i = 0; i < 25; i += 1) {
      await suggestion(user, {
        title: `observation ${i}`,
        confidence: 0.9,
        localDate: TODAY,
        proposed: OBSERVATION,
      });
    }

    const shown = await titles(user);
    expect(shown).toHaveLength(3);
    expect(shown[0]).toBe('actionable');
  });
});

describe('POST /inferences/:id/resolve — habit', () => {
  it('logs the habit as inferred and closes the suggestion', async () => {
    const user = await seedUser();
    const habit = await HabitModel.create({
      userId: new Types.ObjectId(user.id),
      name: 'Morning run',
      icon: 'activity',
      color: '#7D927D',
      frequency: 'daily',
      measure: 'check',
      targetCount: 1,
    });
    const pending = await suggestion(user, {
      title: 'Mark Morning run done?',
      confidence: 0.8,
      localDate: TODAY,
      type: 'possible_habit_completion',
      proposed: { kind: 'habit', habitId: habit._id.toString(), count: 1 },
    });

    const app = await buildApp(user);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/inferences/${pending._id.toString()}/resolve`,
        payload: { action: 'confirm' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe('confirmed');
    } finally {
      await app.close();
    }

    const log = await HabitLogModel.findOne({ habitId: habit._id }).lean();
    expect(log!.count).toBe(1);
    expect(log!.source).toBe('inferred');
    expect((await InferredContextModel.findById(pending._id).lean())!.status).toBe('confirmed');
  });
});
