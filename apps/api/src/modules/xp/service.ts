import { Types } from 'mongoose';
import type { XpAward } from '@synitheia/shared';
import { UserModel, XpAwardModel } from '../../db/models.js';

/** Mongo's error code for a duplicate key on a unique index. */
const DUPLICATE_KEY_ERROR_CODE = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR_CODE
  );
}

/**
 * Grant a batch of XP awards to a user, returning the XP actually applied.
 *
 * `XpAwardModel` is the ledger — the append-only, truthful record of every award ever
 * earned. `user.xp` is a **cache** of that ledger's sum, kept in sync here for cheap
 * reads (a profile header has no business summing every row on every request). Because
 * it is a cache, it is recomputable: the ledger can always be re-summed to detect (and
 * correct) drift, which is what makes a mismatch a bug to fix rather than data that is
 * gone forever. That is a different animal from the bare counter warned against in
 * nutrition/service.ts, where there is no underlying log to recompute from — there, the
 * counter IS the only record, and drift is unrecoverable. Here it never can be, because
 * the ledger is retained.
 *
 * The unique `{ userId, key }` index is the only thing standing between this function
 * and double-awarding. Awards are never checked for existence first — that is a
 * check-then-act race, and under the mobile app's optimistic habit checkbox it is a
 * live one. Instead every award is inserted directly; a duplicate-key error (Mongo code
 * 11000) means "already granted" and is swallowed, while any other error propagates,
 * since silently swallowing an arbitrary write failure would silently lose a real award.
 */
export async function grantAwards(userId: string, awards: readonly XpAward[]): Promise<number> {
  if (awards.length === 0) return 0;

  const userObjectId = new Types.ObjectId(userId);
  let granted = 0;

  for (const award of awards) {
    try {
      await XpAwardModel.create({
        userId: userObjectId,
        key: award.key,
        amount: award.amount,
      });
      granted += award.amount;
    } catch (error) {
      if (isDuplicateKeyError(error)) continue;
      throw error;
    }
  }

  if (granted > 0) {
    await UserModel.updateOne({ _id: userObjectId }, { $inc: { xp: granted } });
  }

  return granted;
}
