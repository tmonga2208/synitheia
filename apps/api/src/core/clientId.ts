import { Types } from 'mongoose';
import { AppError } from './errors.js';

/**
 * Create with the id the app chose, when it chose one (shared `clientIdSchema`).
 *
 * Something made offline is created on the server only when the connection returns, but
 * the app gave it an id the moment it was made, and may already have ticked or edited it
 * under that id. Keeping it is what makes those later changes land on the right record.
 */
export function withClientId<T extends object>(id: string | undefined, doc: T): T {
  return id ? { ...doc, _id: new Types.ObjectId(id) } : doc;
}

/**
 * Turn "that _id already exists" into a 409 the app understands, instead of a 500. A
 * repeat of the same change is answered by core/idempotency.ts before it gets here; this
 * is a different change reusing an id, which should never happen and must not overwrite.
 */
export function rethrowTakenId(error: unknown): never {
  const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> };
  if (duplicate?.code === 11000 && duplicate.keyPattern && '_id' in duplicate.keyPattern) {
    throw AppError.conflict('Something with this id already exists.');
  }
  throw error;
}
