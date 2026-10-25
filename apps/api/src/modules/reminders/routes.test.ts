import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { ReminderModel } from '../../db/models.js';
import { registerReminderRoutes } from './routes.js';

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
  await ReminderModel.deleteMany({});
});

const userId = new Types.ObjectId();

async function app() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    req.user = { id: userId.toString(), timezone: 'Asia/Kolkata', currency: 'INR' };
  });
  app.setErrorHandler((error, _req, reply) =>
    reply.status(error instanceof AppError ? error.status : 400).send({ message: error.message }),
  );
  await registerReminderRoutes(app);
  return app;
}

async function intervalReminder() {
  return ReminderModel.create({
    userId,
    kind: 'water',
    label: 'Water',
    repeat: 'interval',
    time: null,
    weekdays: [],
    intervalMinutes: 60,
    windowStart: '09:00',
    windowEnd: '21:00',
    enabled: true,
  });
}

describe('PATCH /reminders/:id', () => {
  it('refuses a change that leaves the window ending before it starts', async () => {
    const reminder = await intervalReminder();

    const res = await (await app()).inject({
      method: 'PATCH',
      url: `/reminders/${reminder._id.toString()}`,
      payload: { windowStart: '23:00' },
    });

    expect(res.statusCode).toBe(400);
    expect((await ReminderModel.findById(reminder._id).lean())!.windowStart).toBe('09:00');
  });

  it('refuses a change that would make one reminder fire too often to schedule', async () => {
    const reminder = await intervalReminder();

    const res = await (await app()).inject({
      method: 'PATCH',
      url: `/reminders/${reminder._id.toString()}`,
      payload: { intervalMinutes: 5 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('still accepts a bare on/off toggle', async () => {
    const reminder = await intervalReminder();

    const res = await (await app()).inject({
      method: 'PATCH',
      url: `/reminders/${reminder._id.toString()}`,
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect((await ReminderModel.findById(reminder._id).lean())!.enabled).toBe(false);
  });
});
