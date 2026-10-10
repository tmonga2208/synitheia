import type { FastifyBaseLogger } from 'fastify';
import { todayLocalDate, type SyncSuggestion } from '@synitheia/shared';
import { runDetectors } from './run.js';

/**
 * Run detectors because data just arrived, and say what that produced.
 *
 * Never throws. A sync that stored the user's steps must not report failure because a
 * rule that reads them had a bug — the client would retry a write that already worked.
 */
export async function detectAfterSync(
  user: { id: string; timezone: string; currency?: string },
  logger?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<SyncSuggestion[]> {
  try {
    return await runDetectors(user.id, user.timezone, todayLocalDate(user.timezone), {
      currency: user.currency ?? null,
    });
  } catch (err: unknown) {
    logger?.warn({ err }, 'detectors failed after sync; returning no suggestions');
    return [];
  }
}
