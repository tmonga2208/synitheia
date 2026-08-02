/* eslint-disable no-console -- A CLI repair tool's output IS its interface. */
import { pathToFileURL } from 'node:url';
import mongoose, { type Types } from 'mongoose';
import { loadEnv } from '../config/env.js';
import { UserModel, XpAwardModel } from '../db/models.js';

/**
 * Re-derive `user.xp` from the XP ledger.
 *
 * The XP spec's central claim is that `user.xp` is a CACHE of the ledger's sum, and that
 * being recomputable is exactly what separates it from the bare counter
 * `nutrition/service.ts` warns about ("The tempting alternative — `$inc` the totals by
 * the delta on each write — drifts"). There, the counter IS the only record and drift is
 * unrecoverable. Here the ledger is append-only and never deleted, so the information to
 * repair the cache always exists — but only if something actually re-derives it. This is
 * that something. Without it the claim is aspirational, and drift, though theoretically
 * recoverable, stays in place forever.
 *
 * Drift is not hypothetical. `grantAwards` commits ledger rows one at a time and applies
 * a single `$inc` at the end; a transient failure on insert 2 of 3 leaves award 1
 * ledgered with no increment. Its doc comment assigns the self-healing property to a
 * caller that retries the SAME batch — and none of the three call sites retries at all.
 * The next log offers a different batch, the already-committed row collides on 11000,
 * and that XP is missing from the cache permanently.
 *
 * This is a repair tool, not a feature: nothing calls it on a schedule and nothing calls
 * it from a request. Run it when a total is in doubt.
 *
 *   pnpm --filter @synitheia/api recompute-xp              # every user
 *   pnpm --filter @synitheia/api recompute-xp me@x.com     # one user
 */

export interface RecomputeReport {
  checked: number;
  corrected: number;
  /** Every total that moved, so a run leaves a record of what was wrong. */
  drift: { userId: string; was: number; now: number }[];
}

export async function recomputeXp(email?: string): Promise<RecomputeReport> {
  const filter: Record<string, unknown> = {};

  if (email) {
    const user = await UserModel.findOne({ email: email.toLowerCase() }, { _id: 1 }).lean();
    // Loud rather than a clean run over zero users — a typo'd email must not look like
    // "checked everything, nothing wrong".
    if (!user) throw new Error(`No user ${email}`);
    filter._id = user._id;
  }

  const users = await UserModel.find(filter, { xp: 1 }).lean();
  const userIds = users.map((u) => u._id as Types.ObjectId);

  const sums = await XpAwardModel.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { userId: { $in: userIds } } },
    { $group: { _id: '$userId', total: { $sum: '$amount' } } },
  ]);

  const ledgerTotal = new Map(sums.map((s) => [s._id.toString(), s.total]));

  const report: RecomputeReport = { checked: users.length, corrected: 0, drift: [] };

  for (const user of users) {
    const id = (user._id as Types.ObjectId).toString();

    /**
     * No ledger rows means zero, not "leave it alone". The ledger is the truth, so a
     * total with nothing behind it is drift in the other direction and gets corrected
     * the same way. Nothing in this codebase writes `xp` except `grantAwards`, so there
     * is no hand-set value this can destroy.
     */
    const expected = ledgerTotal.get(id) ?? 0;
    if (user.xp === expected) continue;

    await UserModel.updateOne({ _id: user._id }, { $set: { xp: expected } });
    report.corrected += 1;
    report.drift.push({ userId: id, was: user.xp, now: expected });
  }

  return report;
}

async function main(): Promise<void> {
  const email = process.argv[2];

  const env = loadEnv();
  await mongoose.connect(env.MONGO_URI);

  const report = await recomputeXp(email);

  for (const d of report.drift) {
    console.log(`  ${d.userId}  ${d.was} → ${d.now}`);
  }
  console.log(`\n  ${report.checked} checked · ${report.corrected} corrected`);

  await mongoose.disconnect();
}

// Only when run as a script. Exported above so the recomputation can be tested without
// a live database URI or a process exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
