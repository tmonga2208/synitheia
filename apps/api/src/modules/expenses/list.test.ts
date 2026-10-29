import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { LocalDate } from '@synitheia/shared';
import { ExpenseCategoryModel, UserModel } from '../../db/models.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { createExpense, listExpenses } from './service.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});

async function setup() {
  const u = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Reader',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  });
  const user: AuthedUser = { id: u._id.toString(), timezone: 'Asia/Kolkata', currency: 'INR' };
  const category = (
    await ExpenseCategoryModel.create({ userId: u._id, name: 'Other', icon: 'circle', color: '#A3A3A0' })
  )._id.toString();
  return { user, category };
}

/** Noon in India on a September day. */
const on = (day: number) => new Date(Date.UTC(2026, 8, day, 6, 30));
const SEPTEMBER = { from: '2026-09-01' as LocalDate, to: '2026-09-30' as LocalDate };

describe('listExpenses', () => {
  it('pages newest first, and the pages add up to every payment exactly once', async () => {
    const { user, category } = await setup();
    // Several on one day share a timestamp, as a statement import files them.
    for (let day = 1; day <= 4; day++) {
      for (let n = 0; n < 3; n++) {
        await createExpense(user, { amountMinor: day * 100 + n, categoryId: category, occurredAt: on(day) });
      }
    }

    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listExpenses(user, { ...SEPTEMBER, limit: 5, before: cursor });
      seen.push(...page.items.map((e) => e.amountMinor));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen.slice(0, 3).every((a) => a >= 400)).toBe(true);
  });

  it('says there is no next page when everything fits', async () => {
    const { user, category } = await setup();
    await createExpense(user, { amountMinor: 100, categoryId: category, occurredAt: on(2) });
    await createExpense(user, { amountMinor: 200, categoryId: category, occurredAt: on(3) });

    const page = await listExpenses(user, { ...SEPTEMBER, limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeUndefined();
  });

  it('rejects a cursor it did not write', async () => {
    const { user } = await setup();

    await expect(listExpenses(user, { ...SEPTEMBER, limit: 5, before: 'not-a-cursor' })).rejects.toThrow();
  });
});
