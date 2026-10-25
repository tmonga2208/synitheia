import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IdempotencyRecordModel } from '../db/models.js';
import { AppError } from './errors.js';
import { registerIdempotency } from './idempotency.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await IdempotencyRecordModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await IdempotencyRecordModel.deleteMany({});
});

const USER = new Types.ObjectId().toString();

let runs = 0;
let release: (() => void) | null = null;

async function app(): Promise<FastifyInstance> {
  const server = Fastify();
  server.decorate('requireAuth', async (req: FastifyRequest) => {
    (req as unknown as { user: { id: string; timezone: string } }).user = {
      id: USER,
      timezone: 'Asia/Kolkata',
    };
  });
  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  registerIdempotency(server);

  const auth = { onRequest: [server.requireAuth] };
  server.post('/count', auth, async (_req, reply) => {
    runs += 1;
    return reply.status(201).send({ run: runs });
  });
  server.delete('/thing', auth, async (_req, reply) => {
    runs += 1;
    return reply.status(204).send();
  });
  server.post('/refuse', auth, async () => {
    runs += 1;
    throw AppError.badRequest('Habit not found');
  });
  server.post('/explode', auth, async () => {
    runs += 1;
    throw new Error('boom');
  });
  server.post('/slow', auth, async () => {
    runs += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { done: true };
  });
  server.post('/public', async () => {
    runs += 1;
    return { run: runs };
  });

  await server.ready();
  return server;
}

const post = (server: FastifyInstance, url: string, key?: string) =>
  server.inject({ method: 'POST', url, headers: key ? { 'idempotency-key': key } : {} });

beforeEach(() => {
  runs = 0;
  release = null;
});

describe('idempotency keys', () => {
  it('runs a change once, and answers a repeat with the same answer', async () => {
    const server = await app();

    const first = await post(server, '/count', 'key-aaaaaaaa');
    const again = await post(server, '/count', 'key-aaaaaaaa');

    expect(runs).toBe(1);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect(again.headers['idempotent-replay']).toBe('true');
  });

  it('replays an empty answer too', async () => {
    const server = await app();

    await server.inject({ method: 'DELETE', url: '/thing', headers: { 'idempotency-key': 'key-delete-1' } });
    const again = await server.inject({
      method: 'DELETE',
      url: '/thing',
      headers: { 'idempotency-key': 'key-delete-1' },
    });

    expect(runs).toBe(1);
    expect(again.statusCode).toBe(204);
  });

  it('runs changes with different keys separately', async () => {
    const server = await app();

    await post(server, '/count', 'key-aaaaaaaa');
    await post(server, '/count', 'key-bbbbbbbb');

    expect(runs).toBe(2);
  });

  it('replays a refusal, because the same change would be refused again', async () => {
    const server = await app();

    await post(server, '/refuse', 'key-refuse-1');
    const again = await post(server, '/refuse', 'key-refuse-1');

    expect(runs).toBe(1);
    expect(again.statusCode).toBe(400);
    expect(again.json().error.message).toBe('Habit not found');
  });

  it('forgets a server failure, so the change can be tried again', async () => {
    const server = await app();

    await post(server, '/explode', 'key-explode-1');
    await post(server, '/explode', 'key-explode-1');

    expect(runs).toBe(2);
  });

  it('says a change is still being saved when its repeat arrives first', async () => {
    const server = await app();

    const first = post(server, '/slow', 'key-slow-001');
    await expect.poll(() => release).not.toBeNull();
    const again = await post(server, '/slow', 'key-slow-001');
    release!();
    await first;

    expect(again.statusCode).toBe(409);
    expect(runs).toBe(1);
  });

  it('refuses a key reused for a different change', async () => {
    const server = await app();

    await post(server, '/count', 'key-shared-1');
    const other = await post(server, '/refuse', 'key-shared-1');

    expect(other.statusCode).toBe(422);
    expect(runs).toBe(1);
  });

  it('leaves requests without a key, or without a signed-in user, alone', async () => {
    const server = await app();

    await post(server, '/count');
    await post(server, '/count');
    await post(server, '/public', 'key-public-1');
    await post(server, '/public', 'key-public-1');

    expect(runs).toBe(4);
    expect(await IdempotencyRecordModel.countDocuments()).toBe(0);
  });
});
