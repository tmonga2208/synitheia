import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { ingestPdf } from './ingestion.js';
import type { Env } from '../../config/env.js';
import type { AuthedUser } from '../../core/auth-guard.js';

/**
 * Password-protected bank statements.
 *
 * This is not an edge case. A bank e-statement arrives locked as a matter of course — a
 * PAN, a date of birth, a customer id — so "the PDF is encrypted" is the NORMAL state of
 * the single file this feature exists to import. It used to be a dead end: one apologetic
 * sentence, no way to supply the password, and the statement was simply unimportable.
 *
 * These tests never reach the model. Every case here fails (or is decided) while opening
 * the document, which is the whole point — the extractor is expensive and non-deterministic
 * and must not be the thing that discovers a password was needed.
 */

const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)));

/** The fixtures are the same statement, one locked with this password and one not. */
const PASSWORD = 'TARU2208';

const user = { id: '000000000000000000000001', currency: 'INR' } as AuthedUser;
/** Never reached: every assertion below throws before the extractor is called. */
const env = {} as Env;

async function errorFrom(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('Expected the ingestion to throw, but it resolved.');
}

describe('ingestPdf', () => {
  it('asks for a password when the statement is locked', async () => {
    const err = await errorFrom(ingestPdf(env, user, fixture('statement-locked.pdf')));

    // The CODE is the contract — the app decides whether to show a password field on it.
    // Were this a plain ingestion_failed, the app could only tell the two apart by matching
    // English prose, which breaks the first time the copy changes.
    expect(err.code).toBe('pdf_password_required');
    expect(err.status).toBe(422);
  });

  it('says the password was WRONG rather than asking again as if nothing happened', async () => {
    const err = await errorFrom(
      ingestPdf(env, user, fixture('statement-locked.pdf'), 'not-the-password'),
    );

    expect(err.code).toBe('pdf_password_required');
    // "Enter the password" and "that password was wrong" send a user to two completely
    // different places. Collapsing them into one sentence is how someone retypes a correct
    // password five times.
    expect(err.message).toMatch(/did not open/i);
  });

  it('opens a locked statement with the right password', async () => {
    // Reaching the extractor at all is the assertion: the document opened. It then fails on
    // the empty Env, which proves we got past the parser rather than tripping over the lock.
    const err = await errorFrom(
      ingestPdf(env, user, fixture('statement-locked.pdf'), PASSWORD),
    );

    expect(err.code).not.toBe('pdf_password_required');
  });

  it('does not demand a password from a statement that has none', async () => {
    const err = await errorFrom(ingestPdf(env, user, fixture('statement.pdf')));

    expect(err.code).not.toBe('pdf_password_required');
  });

  it('does not blame a password when the file is simply not a PDF', async () => {
    const err = await errorFrom(
      ingestPdf(env, user, Buffer.from('this is not a pdf, it is a sentence')),
    );

    // The old code caught every failure and guessed "it may be encrypted" — which sent
    // people hunting for a password to a file that never had one.
    expect(err.code).toBe('ingestion_failed');
    expect(err.message).not.toMatch(/password/i);
  });
});
