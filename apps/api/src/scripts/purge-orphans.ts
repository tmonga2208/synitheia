/* eslint-disable no-console -- A CLI repair tool's output IS its interface. */
import { pathToFileURL } from 'node:url';
import mongoose, { type Types } from 'mongoose';
import { loadEnv } from '../config/env.js';
import { UserModel } from '../db/models.js';

/**
 * Delete what deleted accounts left behind.
 *
 * Until October 2026 account deletion removed the account and most of its data, but not its
 * daily health records, subscriptions, expense categories or XP ledger. The route is fixed;
 * this removes the rows it had already stranded. A row is a leftover when it carries a
 * `userId` and no user has that id.
 *
 * It asks the models which collections carry a `userId`, for the reason the route's test
 * does: a list written down here would be out of date by the next collection.
 *
 * It reports by default and deletes only when told to:
 *
 *   pnpm --filter @synitheia/api purge-orphans             # what would go
 *   pnpm --filter @synitheia/api purge-orphans -- --apply  # delete it
 *
 * This is a repair tool, not a feature: nothing calls it on a schedule or from a request.
 */

export interface OrphanReport {
  applied: boolean;
  /** Accounts that no longer exist but still own rows. */
  accounts: number;
  rows: number;
  collections: { name: string; rows: number }[];
}

type UserScopedModel = (typeof mongoose.models)[string];

export interface OrphanCandidates {
  found: { model: UserScopedModel; ids: Types.ObjectId[] }[];
}

/** Rows whose owner was not among the users when this looked. Candidates, not a verdict. */
export async function findOrphans(): Promise<OrphanCandidates> {
  const users = await UserModel.find({}, { _id: 1 }).lean();
  const living = new Set(users.map((user) => String(user._id)));

  const found: OrphanCandidates['found'] = [];
  for (const model of Object.values(mongoose.models)) {
    if (model.schema.path('userId') === undefined) continue;

    const owners = (await model.distinct('userId')) as (Types.ObjectId | null)[];
    const ids = owners.filter((id): id is Types.ObjectId => id !== null && !living.has(String(id)));
    if (ids.length > 0) found.push({ model, ids });
  }

  return { found };
}

/**
 * Count the leftovers, and delete them if `apply` is set.
 *
 * Every candidate account is looked up again first. Someone can sign up while this runs, and
 * their first rows may be seen before their account is: sign-up writes the account, then the
 * rows, so by the time the rows are visible the account is too, and this second look finds
 * it. Without it, a new user's data would be deleted as a leftover.
 */
export async function deleteOrphans(
  { found }: OrphanCandidates,
  { apply }: { apply: boolean },
): Promise<OrphanReport> {
  const candidates = new Set(found.flatMap(({ ids }) => ids.map(String)));
  const gone = new Set<string>();
  for (const id of candidates) {
    if ((await UserModel.exists({ _id: id })) === null) gone.add(id);
  }

  const report: OrphanReport = { applied: apply, accounts: gone.size, rows: 0, collections: [] };

  for (const { model, ids } of found) {
    const orphaned = ids.filter((id) => gone.has(String(id)));
    if (orphaned.length === 0) continue;

    const filter = { userId: { $in: orphaned } };
    const rows = await model.countDocuments(filter);
    if (rows === 0) continue;

    if (apply) await model.deleteMany(filter);
    report.collections.push({ name: model.modelName, rows });
    report.rows += rows;
  }

  return report;
}

export async function purgeOrphans(options: { apply: boolean }): Promise<OrphanReport> {
  return deleteOrphans(await findOrphans(), options);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const env = loadEnv();
  await mongoose.connect(env.MONGO_URI);

  const report = await purgeOrphans({ apply });

  for (const entry of report.collections) {
    console.log(`  ${entry.name.padEnd(22)} ${entry.rows}`);
  }
  console.log(
    `\n  ${report.rows} rows from ${report.accounts} deleted accounts · ` +
      (apply ? 'deleted' : 'nothing deleted (run again with --apply)'),
  );

  await mongoose.disconnect();
}

// Only when run as a script. Exported above so it can be tested without a live database URI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
