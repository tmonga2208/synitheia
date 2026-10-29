/* eslint-disable no-console -- A CLI repair tool's output IS its interface. */
import { pathToFileURL } from 'node:url';
import mongoose, { type Types } from 'mongoose';
import { asLocalDate, isLocalDate, startOfLocalDay, type LocalDate } from '@synitheia/shared';
import { loadEnv } from '../config/env.js';
import { DailySummaryModel, PersonalEventModel } from '../db/models.js';

/**
 * Move habit completions back onto the day they were for.
 *
 * Until October 2026 a habit ticked for an earlier day (from a day's page or the history
 * calendar) put its timeline entry on the day of the tap, so "Read completed" showed under
 * today. The route is fixed; this repairs the entries it had already filed. Each entry's
 * dedupe key, `manual:habit:<habitId>:<localDate>`, records the day it was for, so nothing
 * is guessed: an entry whose `localDate` disagrees with its key is moved to midday of the
 * key's day, as the fixed route now does, and both days' cached summaries are dropped so
 * they rebuild from what is there.
 *
 *   pnpm --filter @synitheia/api repair-habit-timeline             # what would move
 *   pnpm --filter @synitheia/api repair-habit-timeline -- --apply  # move it
 *
 * A repair tool, not a feature: nothing calls it on a schedule or from a request.
 */

const KEY = /^manual:habit:[0-9a-f]{24}:(\d{4}-\d{2}-\d{2})$/;
const MIDDAY_MS = 12 * 60 * 60 * 1000;

export interface TimelineRepairReport {
  applied: boolean;
  /** Entries filed under a day other than the one their key names. */
  misfiled: number;
  users: number;
  examples: { from: string; to: string }[];
}

interface Misfiled {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  localDate: string;
  timezone: string;
  intended: LocalDate;
}

export async function findMisfiled(): Promise<Misfiled[]> {
  const events = await PersonalEventModel.find(
    { type: 'habit.completed', dedupeKey: { $regex: '^manual:habit:' } },
    { userId: 1, localDate: 1, timezone: 1, dedupeKey: 1 },
  ).lean();

  const misfiled: Misfiled[] = [];
  for (const event of events) {
    const day = KEY.exec(String(event.dedupeKey ?? ''))?.[1];
    if (!day || !isLocalDate(day) || day === event.localDate) continue;
    misfiled.push({
      _id: event._id as Types.ObjectId,
      userId: event.userId as Types.ObjectId,
      localDate: String(event.localDate),
      timezone: String(event.timezone),
      intended: asLocalDate(day),
    });
  }
  return misfiled;
}

export async function repairHabitTimeline(apply: boolean): Promise<TimelineRepairReport> {
  const misfiled = await findMisfiled();

  if (apply) {
    for (const entry of misfiled) {
      const timestamp = new Date(startOfLocalDay(entry.intended, entry.timezone).getTime() + MIDDAY_MS);
      await PersonalEventModel.updateOne(
        { _id: entry._id },
        { $set: { localDate: entry.intended, timestamp } },
      );
      await DailySummaryModel.deleteMany({
        userId: entry.userId,
        localDate: { $in: [entry.localDate, entry.intended] },
      });
    }
  }

  return {
    applied: apply,
    misfiled: misfiled.length,
    users: new Set(misfiled.map((m) => String(m.userId))).size,
    examples: misfiled.slice(0, 5).map((m) => ({ from: m.localDate, to: m.intended })),
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const apply = process.argv.includes('--apply');
  await mongoose.connect(env.MONGO_URI);
  try {
    const report = await repairHabitTimeline(apply);
    console.log(
      `${report.misfiled} habit completion(s) across ${report.users} account(s) ${
        apply ? 'moved to' : 'would move to'
      } the day they were for.`,
    );
    for (const e of report.examples) console.log(`  ${e.from} -> ${e.to}`);
    if (!apply && report.misfiled > 0) console.log('Run again with --apply to move them.');
  } finally {
    await mongoose.disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
