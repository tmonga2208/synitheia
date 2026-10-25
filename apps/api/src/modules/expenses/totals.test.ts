import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { LocalDate } from '@synitheia/shared';
import { ExpenseCategoryModel, UserModel } from '../../db/models.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { createExpense, totalsFor } from './service.js';

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
  const category = async (name: string) =>
    (await ExpenseCategoryModel.create({ userId: u._id, name, icon: 'circle', color: '#A3A3A0' }))._id.toString();
  return { user, food: await category('Food'), other: await category('Other') };
}

/** Noon in India on a September day. */
const on = (day: number) => new Date(Date.UTC(2026, 8, day, 6, 30));
const SEPTEMBER = ['2026-09-01', '2026-09-30'] as [LocalDate, LocalDate];

describe('totalsFor', () => {
  it('adds up each day that had spending, and only those days', async () => {
    const { user, food, other } = await setup();
    await createExpense(user, { amountMinor: 4200000, categoryId: other, merchant: 'Rent', occurredAt: on(4) });
    await createExpense(user, { amountMinor: 60700, categoryId: food, merchant: 'Zepto', occurredAt: on(4) });
    await createExpense(user, { amountMinor: 20000, categoryId: food, merchant: 'Zepto', occurredAt: on(19) });
    await createExpense(user, { amountMinor: 15000, categoryId: food, occurredAt: on(19) });

    const totals = await totalsFor(user, ...SEPTEMBER);

    expect(totals.byDay).toEqual({ '2026-09-04': 4260700, '2026-09-19': 35000 });
  });

  it('names who the money mostly went to, biggest first, by category when there is no payee', async () => {
    const { user, food, other } = await setup();
    await createExpense(user, { amountMinor: 4200000, categoryId: other, merchant: 'Rent', occurredAt: on(4) });
    await createExpense(user, { amountMinor: 60700, categoryId: food, merchant: 'Zepto', occurredAt: on(4) });
    await createExpense(user, { amountMinor: 20000, categoryId: food, merchant: 'Zepto', occurredAt: on(19) });
    await createExpense(user, { amountMinor: 15000, categoryId: food, occurredAt: on(19) });

    const totals = await totalsFor(user, ...SEPTEMBER);

    expect(totals.topPayees).toEqual([
      { name: 'Rent', totalMinor: 4200000, count: 1, categoryName: 'Other' },
      { name: 'Zepto', totalMinor: 80700, count: 2, categoryName: 'Food' },
      { name: 'Food', totalMinor: 15000, count: 1, categoryName: 'Food' },
    ]);
  });

  it('keeps the six biggest payees', async () => {
    const { user, other } = await setup();
    for (let i = 1; i <= 8; i++) {
      await createExpense(user, { amountMinor: i * 1000, categoryId: other, merchant: `Payee ${i}`, occurredAt: on(i) });
    }

    const totals = await totalsFor(user, ...SEPTEMBER);

    expect(totals.topPayees.map((p) => p.name)).toEqual(['Payee 8', 'Payee 7', 'Payee 6', 'Payee 5', 'Payee 4', 'Payee 3']);
  });

  it('counts what a repaid split actually cost, the same way as the total', async () => {
    const { user, food } = await setup();
    await createExpense(user, {
      amountMinor: 100000,
      categoryId: food,
      merchant: 'Dinner',
      occurredAt: on(12),
      participants: [{ name: 'Ana', contactId: null, shareMinor: 75000, settledAt: on(13).toISOString() }],
    });

    const totals = await totalsFor(user, ...SEPTEMBER);

    expect(totals.totalMinor).toBe(25000);
    expect(totals.byDay).toEqual({ '2026-09-12': 25000 });
    expect(totals.topPayees[0]).toMatchObject({ name: 'Dinner', totalMinor: 25000 });
  });
});
