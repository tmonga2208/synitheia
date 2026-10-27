import { Types } from 'mongoose';
import {
  addLocalDays,
  netMinor,
  owedMinor,
  startOfLocalMonth,
  sumMoney,
  toLocalDate,
  type ClientId,
  type CreateExpenseInput,
  type DataSource,
  type LocalDate,
  type Minor,
  type Participant,
  type UpdateExpenseInput,
} from '@synitheia/shared';
import { AppError } from '../../core/errors.js';
import { rethrowTakenId, withClientId } from '../../core/clientId.js';
import {
  ExpenseCategoryModel,
  ExpenseModel,
  type ExpenseDoc,
  type ExpenseHydrated,
} from '../../db/models.js';
import { invalidateDailySummary } from '../../context/aggregator.js';
import { dedupeKey, emit, retractByRef } from '../../context/engine.js';
import type { AuthedUser } from '../../core/auth-guard.js';

/**
 * Two distinct shapes, deliberately not interchangeable.
 *
 * A hydrated document has `.save()` and change tracking; a `.lean()` result is a plain
 * object and does not. Casting one to the other compiles away the difference and then
 * `.save()` is undefined at runtime — so they get separate names and the compiler
 * keeps them apart.
 */
type ExpenseLean = ExpenseDoc & { _id: Types.ObjectId };

/**
 * Read participants off a lean document, tolerating their absence.
 *
 * Expenses written before splitting existed have no `participants` key at all, and
 * Mongoose does NOT apply schema defaults to `.lean()` reads — so the field is genuinely
 * `undefined`, not `[]`. Every read path has to survive that, or the feature works
 * perfectly on new data and crashes on everyone's history.
 */
function participantsOf(e: { participants?: unknown }): Participant[] {
  return (e.participants as Participant[] | undefined) ?? [];
}

async function resolveCategory(userId: string, categoryId: string) {
  const category = await ExpenseCategoryModel.findOne({
    _id: new Types.ObjectId(categoryId),
    userId: new Types.ObjectId(userId),
  }).lean();

  // Scoping the lookup by userId is the authorization check — a user must not be
  // able to file an expense against someone else's category by guessing an id.
  if (!category) throw AppError.notFound('Category');
  return category;
}

/**
 * Creating an expense writes two things: the Expense (the source of truth) and its
 * PersonalEvent (the timeline projection). Both, or neither.
 *
 * We do not use a transaction here, and that is deliberate. The event is derived
 * data with a deterministic dedupe key — if the process dies between the two writes,
 * the next read repairs it, and a re-emit is a no-op by construction. Paying the
 * cost of a replica-set transaction on the hottest write path in the app, to protect
 * a projection that is self-healing, is the wrong trade.
 */
export async function createExpense(
  user: AuthedUser,
  input: CreateExpenseInput & ClientId,
  /**
   * Where this came from. Defaults to how it was typed; a recurring bill posts itself
   * with 'subscription' so the app can always say which charges it added on the user's
   * behalf and which they logged. That distinction has to survive forever, not just
   * until the next screen.
   */
  source?: DataSource,
): Promise<ExpenseHydrated> {
  const category = await resolveCategory(user.id, input.categoryId);
  const occurredAt = input.occurredAt ?? new Date();

  const expense = await ExpenseModel.create(withClientId(input.id, {
    userId: new Types.ObjectId(user.id),
    amountMinor: input.amountMinor,
    currency: user.currency,
    categoryId: category._id,
    categoryName: category.name,
    categoryColor: category.color,
    merchant: input.merchant ?? null,
    note: input.note ?? null,
    occurredAt,
    timezone: user.timezone,
    localDate: toLocalDate(occurredAt, user.timezone),
    source: source ?? (input.ingestionId ? 'inferred' : 'manual'),
    ingestionId: input.ingestionId ? new Types.ObjectId(input.ingestionId) : null,

    paidBy: input.paidBy
      ? { name: input.paidBy.name, contactId: input.paidBy.contactId ?? null }
      : null,
    billAmountMinor: input.billAmountMinor ?? null,

    // Nobody owes you when someone else fronted the money. The zod schema rejects this
    // combination at the edge; this is the belt to that pair of braces.
    participants: (input.paidBy ? [] : (input.participants ?? [])).map((p) => ({
      name: p.name,
      contactId: p.contactId ?? null,
      shareMinor: p.shareMinor,
      settledAt: p.settledAt ?? null,
    })),
  })).catch(rethrowTakenId);

  // Invalidate before the event emit, not after: emit is a second write that can
  // throw (or be down) once the expense itself has safely landed, and a stale summary
  // sitting behind a caught exception is exactly the bug this call exists to prevent.
  await invalidateDailySummary(user.id, expense.localDate as LocalDate);

  await emit({
    userId: user.id,
    source: expense.source as DataSource,
    timestamp: occurredAt,
    timezone: user.timezone,
    refId: expense._id,
    dedupeKey: dedupeKey('manual', 'expense', expense._id.toString()),
    metadata: {
      type: 'expense.created',
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      categoryName: category.name,
      categoryColor: category.color,
      merchant: expense.merchant ?? null,
      note: expense.note ?? null,
    },
  });

  return expense;
}

export async function updateExpense(
  user: AuthedUser,
  id: string,
  input: UpdateExpenseInput,
): Promise<ExpenseHydrated> {
  const expense = await ExpenseModel.findOne({
    _id: new Types.ObjectId(id),
    userId: new Types.ObjectId(user.id),
  });

  if (!expense) throw AppError.notFound('Expense');

  const previousLocalDate = expense.localDate;

  if (input.categoryId && input.categoryId !== expense.categoryId.toString()) {
    const category = await resolveCategory(user.id, input.categoryId);
    expense.categoryId = category._id;
    expense.categoryName = category.name;
    expense.categoryColor = category.color;
  }

  if (input.amountMinor !== undefined) expense.amountMinor = input.amountMinor;
  if (input.merchant !== undefined) expense.merchant = input.merchant ?? null;
  if (input.note !== undefined) expense.note = input.note ?? null;

  if (input.occurredAt) {
    expense.occurredAt = input.occurredAt;
    // The timezone stays as it was — moving an expense to a different time does not
    // retroactively relocate the user. Only the local day is recomputed.
    expense.localDate = toLocalDate(input.occurredAt, expense.timezone);
  }

  await expense.save();

  // Invalidate before the re-emit, not after — same reasoning as createExpense: the
  // expense write has already landed, and an exception from emit must not be able to
  // suppress the invalidation for either day.
  if (previousLocalDate !== expense.localDate) {
    await invalidateDailySummary(user.id, previousLocalDate as LocalDate);
  }
  await invalidateDailySummary(user.id, expense.localDate as LocalDate);

  // Re-emit: same dedupeKey, so this updates the existing timeline row in place
  // rather than appending a second one.
  await emit({
    userId: user.id,
    source: expense.source as 'manual',
    timestamp: expense.occurredAt,
    timezone: expense.timezone,
    refId: expense._id,
    dedupeKey: dedupeKey('manual', 'expense', expense._id.toString()),
    metadata: {
      type: 'expense.created',
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      categoryName: expense.categoryName,
      categoryColor: expense.categoryColor,
      merchant: expense.merchant ?? null,
      note: expense.note ?? null,
    },
  });

  return expense;
}

export async function deleteExpense(user: AuthedUser, id: string): Promise<void> {
  const expense = await ExpenseModel.findOneAndDelete({
    _id: new Types.ObjectId(id),
    userId: new Types.ObjectId(user.id),
  }).lean();

  if (!expense) throw AppError.notFound('Expense');

  // The timeline is a projection, not an immutable ledger. A deleted expense must
  // vanish from Today, or the app is visibly lying to the user.
  await retractByRef(user.id, id);
  await invalidateDailySummary(user.id, expense.localDate as LocalDate);
}

export interface ExpenseDetail extends Omit<ExpenseLean, 'participants'> {
  participants: Participant[];
}

export async function getExpense(user: AuthedUser, id: string): Promise<ExpenseDetail> {
  const expense = await ExpenseModel.findOne({
    _id: new Types.ObjectId(id),
    userId: new Types.ObjectId(user.id),
  }).lean<ExpenseLean | null>();

  if (!expense) throw AppError.notFound('Expense');

  // Documents written before splitting existed have no participants key at all.
  return { ...expense, participants: participantsOf(expense) } as ExpenseDetail;
}

export async function listExpenses(
  user: AuthedUser,
  opts: { from?: LocalDate; to?: LocalDate; categoryId?: string; limit: number },
): Promise<ExpenseLean[]> {
  const query: Record<string, unknown> = { userId: new Types.ObjectId(user.id) };

  if (opts.from || opts.to) {
    const range: Record<string, string> = {};
    if (opts.from) range.$gte = opts.from;
    if (opts.to) range.$lte = opts.to;
    query.localDate = range;
  }
  if (opts.categoryId) query.categoryId = new Types.ObjectId(opts.categoryId);

  return ExpenseModel.find(query)
    .sort({ occurredAt: -1 })
    .limit(opts.limit)
    .lean<ExpenseLean[]>();
}

export interface ExpenseTotals {
  /** NET — what it actually cost, after money that has genuinely come back. */
  totalMinor: Minor;
  count: number;
  byCategory: Record<string, number>;
  largestMinor: Minor | null;
  /** Still owed to you. Reported, never subtracted. */
  owedMinor: Minor;
  /** NET per local date, for the days that had any spending. */
  byDay: Record<string, number>;
  /** The biggest payees by NET, at most six: the merchant, or the category when there is none. */
  topPayees: TopPayee[];
}

export interface TopPayee {
  name: string;
  totalMinor: number;
  count: number;
  categoryName: string;
}

const TOP_PAYEES = 6;

/**
 * Totals are computed here, in code, and never by the LLM.
 *
 * Asking a model to sum 18 numbers is asking it to be subtly wrong some fraction of
 * the time, in a domain where being wrong about money destroys trust instantly. The
 * model's job is to notice that Friday food spending is unusual — not to work out
 * what it was.
 */
export async function totalsFor(
  user: AuthedUser,
  from: LocalDate,
  to: LocalDate,
): Promise<ExpenseTotals> {
  const expenses = await ExpenseModel.find(
    {
      userId: new Types.ObjectId(user.id),
      localDate: { $gte: from, $lte: to },
    },
    { amountMinor: 1, categoryName: 1, participants: 1, localDate: 1, merchant: 1 },
  ).lean();

  const byCategory: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const payees = new Map<string, TopPayee>();
  let largest = 0;
  let owed = 0;

  /**
   * Every total here is the NET — what the day actually cost the user, after money that
   * has genuinely come back. A ₹1,000 dinner that three friends have repaid cost ₹250,
   * and reporting ₹1,000 would tell them their Friday spending is four times what it was.
   *
   * What is still OWED is reported separately and never subtracted. An IOU is not money
   * in your pocket, and netting it out would flatter the total with cash the user has not
   * actually been given.
   */
  for (const e of expenses) {
    const net = netMinor({
      amountMinor: e.amountMinor,
      participants: participantsOf(e),
    });

    byCategory[e.categoryName] = (byCategory[e.categoryName] ?? 0) + net;
    byDay[e.localDate] = (byDay[e.localDate] ?? 0) + net;

    const name = e.merchant ?? e.categoryName;
    const payee = payees.get(name) ?? { name, totalMinor: 0, count: 0, categoryName: e.categoryName };
    payee.totalMinor += net;
    payee.count += 1;
    payees.set(name, payee);

    if (net > largest) largest = net;
    owed += owedMinor(participantsOf(e));
  }

  const nets = expenses.map(
    (e) => netMinor({ amountMinor: e.amountMinor, participants: participantsOf(e) }) as Minor,
  );

  return {
    totalMinor: sumMoney(nets),
    count: expenses.length,
    byCategory,
    largestMinor: expenses.length > 0 ? (largest as Minor) : null,
    owedMinor: owed as Minor,
    byDay,
    topPayees: [...payees.values()].sort((a, b) => b.totalMinor - a.totalMinor).slice(0, TOP_PAYEES),
  };
}

/**
 * Mark one participant as having paid you back — or undo it.
 *
 * Indexed by position because participants have no ids of their own; they are a small
 * embedded list, not an entity. The expense's `updatedAt` moves, and any DailySummary for
 * that day is now stale — settling on Friday changes what *Tuesday* cost you, which is
 * correct and is exactly why summaries are a rebuildable cache rather than a ledger.
 */
export async function settleParticipant(
  user: AuthedUser,
  expenseId: string,
  index: number,
  settled: boolean,
): Promise<ExpenseHydrated> {
  const expense = await ExpenseModel.findOne({
    _id: new Types.ObjectId(expenseId),
    userId: new Types.ObjectId(user.id),
  });

  if (!expense) throw AppError.notFound('Expense');

  const participant = expense.participants[index];
  if (!participant) throw AppError.notFound('Person on this expense');

  participant.settledAt = settled ? new Date() : null;
  await expense.save();

  await invalidateDailySummary(user.id, expense.localDate as LocalDate);

  return expense;
}

export interface OwedEntry {
  expenseId: string;
  index: number;
  name: string;
  contactId: string | null;
  shareMinor: number;
  merchant: string | null;
  categoryName: string;
  localDate: string;
  amountMinor: number;
}

/** Everything anyone still owes you, newest first. Backs the settle-up screen. */
export async function listOwed(user: AuthedUser): Promise<OwedEntry[]> {
  const expenses = await ExpenseModel.find({
    userId: new Types.ObjectId(user.id),
    'participants.settledAt': null,
  })
    .sort({ occurredAt: -1 })
    .limit(200)
    .lean<ExpenseLean[]>();

  const out: OwedEntry[] = [];

  for (const e of expenses) {
    participantsOf(e).forEach((p, index) => {
      if (p.settledAt !== null) return;
      out.push({
        expenseId: e._id.toString(),
        index,
        name: p.name,
        contactId: p.contactId,
        shareMinor: p.shareMinor,
        merchant: e.merchant ?? null,
        categoryName: e.categoryName,
        localDate: e.localDate,
        amountMinor: e.amountMinor,
      });
    });
  }

  return out;
}

export async function monthToDateTotal(
  user: AuthedUser,
  today: LocalDate,
): Promise<Minor> {
  const { totalMinor } = await totalsFor(user, startOfLocalMonth(today), today);
  return totalMinor;
}

export async function listCategories(userId: string) {
  return ExpenseCategoryModel.find({ userId: new Types.ObjectId(userId) })
    .sort({ isSystem: -1, name: 1 })
    .lean();
}

export async function createCategory(
  userId: string,
  input: { name: string; icon: string; color: string },
) {
  const existing = await ExpenseCategoryModel.findOne({
    userId: new Types.ObjectId(userId),
    name: input.name.trim(),
  }).lean();

  if (existing) throw AppError.conflict('A category with this name already exists');

  return ExpenseCategoryModel.create({
    userId: new Types.ObjectId(userId),
    ...input,
    name: input.name.trim(),
    isSystem: false,
  });
}

/**
 * Renaming a category backfills every expense that denormalized its name.
 *
 * This is the cost we accepted when we denormalized categoryName/Color onto Expense
 * so the list could render without a join. Paying it here, in a rare operation, is
 * the right side of that trade — but it must actually be paid, or the user renames
 * "Food" to "Dining" and their history still says "Food".
 */
export async function renameCategory(
  userId: string,
  categoryId: string,
  input: { name?: string; icon?: string; color?: string },
) {
  const category = await ExpenseCategoryModel.findOne({
    _id: new Types.ObjectId(categoryId),
    userId: new Types.ObjectId(userId),
  });

  if (!category) throw AppError.notFound('Category');

  if (input.name) category.name = input.name.trim();
  if (input.icon) category.icon = input.icon;
  if (input.color) category.color = input.color;
  await category.save();

  await ExpenseModel.updateMany(
    { userId: new Types.ObjectId(userId), categoryId: category._id },
    { $set: { categoryName: category.name, categoryColor: category.color } },
  );

  return category;
}

/** Yesterday, for the "vs. previous period" comparisons the AI layer needs. */
export function previousPeriod(from: LocalDate, to: LocalDate): [LocalDate, LocalDate] {
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  return [addLocalDays(from, -days), addLocalDays(from, -1)];
}
