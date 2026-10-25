import { ApiError, request } from '../api/client.js';
import type { QueuedChange, SendResult } from './outbox.js';

/**
 * Send one waiting change, and say what became of it.
 *
 * It goes under its own id as its Idempotency-Key, so a change the server already has (its
 * answer was lost on the way back) is answered from the server's record, not applied again.
 *
 *  - 'retry' when trying later can work: no answer, a gateway between the app and the API,
 *    the server busy or restarting, the first send still being saved, a session to renew.
 *    The drain stops there, so nothing made after it overtakes it.
 *  - refused when the server said no: sending it again would get the same answer.
 */

/** Answers that mean "not now". */
const LATER = new Set([401, 408, 425, 429, 502, 503, 504]);

function isStillSaving(error: ApiError): boolean {
  const details = error.details as { inProgress?: unknown } | undefined;
  return error.status === 409 && details?.inProgress === true;
}

export async function replayChange(change: QueuedChange): Promise<SendResult> {
  try {
    await request<unknown>(change.path, {
      method: change.method,
      body: change.body,
      idempotencyKey: change.id,
    });
    return 'done';
  } catch (error) {
    if (!(error instanceof ApiError)) return 'retry';
    // Not the API's own answer: a proxy's page while the server restarts.
    if (error.code === 'unknown') return 'retry';
    if (LATER.has(error.status) || isStillSaving(error)) return 'retry';
    // Gone already is what a deletion wanted.
    if (error.status === 404 && change.method === 'DELETE') return 'done';
    // A fault in the server fails the same way every time. Dropping the change, and saying
    // so, keeps everything made after it from waiting behind it for good.
    if (error.status >= 500) return { refused: 'Something went wrong on our side.' };
    return { refused: error.message };
  }
}
