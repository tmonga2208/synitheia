import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { XP_AMOUNTS, type LocalDate } from '@synitheia/shared';
import {
  ExpenseModel,
  UserModel,
  UserPreferenceModel,
  XpAwardModel,
} from '../../db/models.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import { awardMonthlyBudget } from './routes.js';

let mongo: MongoMemoryReplSet;

const IST = 'Asia/Kolkata';

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await XpAwardModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all([
    ExpenseModel.deleteMany({}),
    XpAwardModel.deleteMany({}),
    UserModel.deleteMany({}),
    UserPreferenceModel.deleteMany({}),
  ]);
});

async function seedUser(): Promise<AuthedUser> {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test User',
    timezone: IST,
    currency: 'INR',
  });
  return { id: user._id.toString(), timezone: IST, currency: 'INR' };
}

async function seedBudget(userId: string, monthlyBudgetMinor: number | null) {
  await UserPreferenceModel.create({
    userId: new Types.ObjectId(userId),
    monthlyBudgetMinor,
  });
}

async function seedExpense(
  userId: string,
  localDate: string,
  amountMinor: number,
  participants: { name: string; contactId: string | null; shareMinor: number; settledAt: Date | null }[] = [],
) {
  await ExpenseModel.create({
    userId: new Types.ObjectId(userId),
    amountMinor,
    currency: 'INR',
    categoryId: new Types.ObjectId(),
    categoryName: 'Misc',
    categoryColor: '#000000',
    occurredAt: new Date(`${localDate}T12:00:00Z`),
    timezone: IST,
    localDate,
    participants,
  });
}

describe('awardMonthlyBudget — /today lazy award', () => {
  it('a month under budget grants once, and a second Today load grants nothing', async () => {
    const user = await seedUser();
    await seedBudget(user.id, 1000);
    await seedExpense(user.id, '2026-07-10', 500);

    const today = '2026-08-15' as LocalDate;

    await awardMonthlyBudget(user, today);
    const afterFirst = (await UserModel.findById(user.id))?.xp;
    expect(afterFirst).toBe(XP_AMOUNTS.monthInBudget);

    await awardMonthlyBudget(user, today);
    const afterSecond = (await UserModel.findById(user.id))?.xp;
    expect(afterSecond).toBe(afterFirst);

    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: 'budget:2026-07',
      }),
    ).toBe(1);
  });

  it('a month over budget grants nothing', async () => {
    const user = await seedUser();
    await seedBudget(user.id, 100);
    await seedExpense(user.id, '2026-07-10', 500);

    await awardMonthlyBudget(user, '2026-08-15' as LocalDate);

    const stored = await UserModel.findById(user.id);
    expect(stored?.xp).toBe(0);
    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: 'budget:2026-07',
      }),
    ).toBe(0);
  });

  it('no budget set grants nothing', async () => {
    const user = await seedUser();
    // No UserPreference document at all — monthlyBudgetMinor is unset.
    await seedExpense(user.id, '2026-07-10', 10);

    await awardMonthlyBudget(user, '2026-08-15' as LocalDate);

    const stored = await UserModel.findById(user.id);
    expect(stored?.xp).toBe(0);
    expect(
      await XpAwardModel.countDocuments({ userId: new Types.ObjectId(user.id) }),
    ).toBe(0);
  });

  it('loading Today mid-month does not grant for the current month', async () => {
    const user = await seedUser();
    await seedBudget(user.id, 1000);
    // July (closed) is comfortably under budget, and so is August (still open) —
    // if the code mistakenly evaluated the current month, this would grant too.
    await seedExpense(user.id, '2026-07-10', 10);
    await seedExpense(user.id, '2026-08-05', 10);

    await awardMonthlyBudget(user, '2026-08-15' as LocalDate);

    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: 'budget:2026-08',
      }),
    ).toBe(0);
    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: 'budget:2026-07',
      }),
    ).toBe(1);
  });

  it('a split expense counts at its net share, not its gross amount', async () => {
    const user = await seedUser();
    await seedBudget(user.id, 700);
    // Gross 1000 is over the 700 budget, but 400 was repaid — net 600 is under it.
    await seedExpense(user.id, '2026-07-10', 1000, [
      { name: 'Friend', contactId: null, shareMinor: 400, settledAt: new Date() },
    ]);

    await awardMonthlyBudget(user, '2026-08-15' as LocalDate);

    const stored = await UserModel.findById(user.id);
    expect(stored?.xp).toBe(XP_AMOUNTS.monthInBudget);
    expect(
      await XpAwardModel.countDocuments({
        userId: new Types.ObjectId(user.id),
        key: 'budget:2026-07',
      }),
    ).toBe(1);
  });
});
