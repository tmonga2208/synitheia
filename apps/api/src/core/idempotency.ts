import { Types } from 'mongoose';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { IdempotencyRecordModel } from '../db/models.js';
import { AppError } from './errors.js';

/**
 * A change sent twice is applied once.
 *
 * The app keeps changes made offline in a queue and sends them when the connection returns,
 * and resends any change whose answer was lost. Each change carries an `Idempotency-Key`;
 * the first time a key is seen the change runs and its answer is stored, and every repeat
 * gets that stored answer instead of running again. Without this, a glass of water logged
 * on a train, sent, and resent after a timeout, would be logged twice.
 *
 * - Only for a signed-in user's writes that carry a key; everything else is untouched.
 * - A refusal (4xx) is stored: the same change would be refused again.
 * - A server failure (5xx) is forgotten, so the change can be tried again.
 * - A repeat that arrives while the first is still running is told so (409), and retries.
 */

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEEP_MS = 48 * 60 * 60 * 1000;

interface Marked {
  idempotency?: { userId: Types.ObjectId; key: string };
}

function isDuplicate(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}

function signedInUser(req: FastifyRequest): string | null {
  const user = (req as unknown as { user?: { id?: string } }).user;
  return typeof user?.id === 'string' ? user.id : null;
}

export function registerIdempotency(app: FastifyInstance): void {
  app.addHook('preHandler', async (req, reply) => {
    if (!WRITES.has(req.method)) return;

    const key = req.headers['idempotency-key'];
    const uid = signedInUser(req);
    if (typeof key !== 'string' || !uid) return;
    if (key.length < 8 || key.length > 64) {
      throw AppError.badRequest('Idempotency-Key must be 8 to 64 characters');
    }

    const userId = new Types.ObjectId(uid);

    try {
      await IdempotencyRecordModel.create({
        userId,
        key,
        method: req.method,
        path: req.url,
        state: 'pending',
        expiresAt: new Date(Date.now() + KEEP_MS),
      });
      (req as Marked).idempotency = { userId, key };
      return;
    } catch (error) {
      if (!isDuplicate(error)) throw error;
    }

    const record = await IdempotencyRecordModel.findOne({ userId, key }).lean();
    if (!record || record.state === 'pending') {
      throw AppError.conflict('This change is still being saved.');
    }
    if (record.method !== req.method || record.path !== req.url) {
      throw new AppError('validation_failed', 'This Idempotency-Key was already used for a different change.');
    }

    reply.header('idempotent-replay', 'true');
    reply.code(record.responseStatus ?? 200);
    return reply.send(record.responseBody ?? undefined);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const mark = (req as Marked).idempotency;
    if (!mark) return payload;

    if (reply.statusCode >= 500) {
      await IdempotencyRecordModel.deleteOne({ userId: mark.userId, key: mark.key });
      return payload;
    }

    let body: unknown = null;
    if (typeof payload === 'string' && payload.length > 0) {
      try {
        body = JSON.parse(payload);
      } catch {
        body = payload;
      }
    }

    await IdempotencyRecordModel.updateOne(
      { userId: mark.userId, key: mark.key },
      { $set: { state: 'done', responseStatus: reply.statusCode, responseBody: body } },
    );
    return payload;
  });
}
