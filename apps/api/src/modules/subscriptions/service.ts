import { Types } from 'mongoose';
import {
  monthlyEquivalent,
  nextDueAfter,
  todayLocalDate,
  type ClientId,
  type CreateSubscriptionInput,
  type LocalDate,
  type UpdateSubscriptionInput,
} from '@synitheia/shared';
import { AppError } from '../../core/errors.js';
import { rethrowTakenId, withClientId } from '../../core/clientId.js';
import {
  ExpenseCategoryModel,
  InferredContextModel,
  SubscriptionModel,
  type SubscriptionDoc,
  type SubscriptionHydrated,
} from '../../db/models.js';
import * as expenses from '../expenses/service.js';
import type { AuthedUser } from '../../core/auth-guard.js';

type SubscriptionLean = SubscriptionDoc & { _id: Types.ObjectId };

async function resolveCategory(userId: string, categoryId: string) {
  const category = await ExpenseCategoryModel.findOne({
    _id: new Types.ObjectId(categoryId),
    userId: new Types.ObjectId(userId),
  }).lean();

  if (!category) throw AppError.notFound('Category');
  return category;
}

export async function listSubscriptions(
  userId: string,
  includeArchived = false,
): Promise<SubscriptionLean[]> {
  const query: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
  if (!includeArchived) query.archivedAt = null;

  return SubscriptionModel.find(query)
    .sort({ nextDueDate: 1 })
    .lean<SubscriptionLean[]>();
}

export async function createSubscription(
  user: AuthedUser,
  input: CreateSubscriptionInput & ClientId,
): Promise<SubscriptionHydrated> {
  const category = await resolveCategory(user.id, input.categoryId);
  const today = todayLocalDate(user.timezone);

  /**
   * The next due date is derived from the anchor, not supplied by the client.
   *
   * A client that computed it with naive month arithmetic would hand us a date that
   * drifts — and we would then trust it forever. Deriving it here means there is exactly
   * one implementation of the rule, and it is the tested one.
   */
  const nextDueDate =
    input.nextDueDate ??
    nextDueAfter(
      // "Strictly after yesterday" so a bill anchored on today is due today, not next month.
      addDay(today, -1),
      input.cycle,
      input.anchorDay,
      input.anchorMonth ?? null,
    );

  return SubscriptionModel.create(
    withClientId(input.id, {
      userId: new Types.ObjectId(user.id),
      name: input.name.trim(),
      amountMinor: input.amountMinor,
      currency: user.currency,
      categoryId: category._id,
      categoryName: category.name,
      categoryColor: category.color,
      cycle: input.cycle,
      anchorDay: input.anchorDay,
      anchorMonth: input.anchorMonth ?? null,
      nextDueDate,
      lastPostedDate: null,
      autoPost: input.autoPost,
      archivedAt: null,
    }),
  ).catch(rethrowTakenId);
}

function addDay(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(
    next.getUTCDate(),
  )}` as LocalDate;
}

export async function updateSubscription(
  user: AuthedUser,
  id: string,
  input: UpdateSubscriptionInput,
): Promise<SubscriptionHydrated> {
  const sub = await SubscriptionModel.findOne({
    _id: new Types.ObjectId(id),
    userId: new Types.ObjectId(user.id),
  });

  if (!sub) throw AppError.notFound('Subscription');

  if (input.categoryId && input.categoryId !== sub.categoryId.toString()) {
    const category = await resolveCategory(user.id, input.categoryId);
    sub.categoryId = category._id;
    sub.categoryName = category.name;
    sub.categoryColor = category.color;
  }

  if (input.name !== undefined) sub.name = input.name.trim();
  if (input.amountMinor !== undefined) sub.amountMinor = input.amountMinor;
  if (input.autoPost !== undefined) sub.autoPost = input.autoPost;
  if (input.anchorMonth !== undefined) sub.anchorMonth = input.anchorMonth ?? null;

  // Changing the schedule re-derives the next date from the new anchor. Keeping the old
  // one would leave the bill landing on a day the user just told us it does not.
  if (input.cycle !== undefined || input.anchorDay !== undefined) {
    if (input.cycle !== undefined) sub.cycle = input.cycle;
    if (input.anchorDay !== undefined) sub.anchorDay = input.anchorDay;

    sub.nextDueDate = nextDueAfter(
      addDay(todayLocalDate(user.timezone), -1),
      sub.cycle as 'weekly' | 'monthly' | 'quarterly' | 'yearly',
      sub.anchorDay,
      sub.anchorMonth ?? null,
    );
  }

  await sub.save();
  return sub;
}

/** Paused, not deleted — a cancelled subscription's charges are still the user's history. */
export async function archiveSubscription(userId: string, id: string): Promise<void> {
  const result = await SubscriptionModel.updateOne(
    { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
    { $set: { archivedAt: new Date() } },
  );

  if (result.matchedCount === 0) throw AppError.notFound('Subscription');
}

export interface SubscriptionSummary {
  monthlyTotalMinor: number;
  activeCount: number;
  nextDue: { name: string; amountMinor: number; dueDate: string } | null;
}

/** "Your subscriptions cost ₹2,340 a month" — the number people actually want. */
export async function summarize(userId: string): Promise<SubscriptionSummary> {
  const subs = await listSubscriptions(userId);

  const monthlyTotalMinor = subs.reduce(
    (acc, s) =>
      acc +
      monthlyEquivalent(s.amountMinor, s.cycle as 'weekly' | 'monthly' | 'quarterly' | 'yearly'),
    0,
  );

  const soonest = subs[0]; // already sorted by nextDueDate

  return {
    monthlyTotalMinor,
    activeCount: subs.length,
    nextDue: soonest
      ? {
          name: soonest.name,
          amountMinor: soonest.amountMinor,
          dueDate: soonest.nextDueDate,
        }
      : null,
  };
}

export interface PostResult {
  posted: number;
  suggested: number;
}

/**
 * Post everything that has come due.
 *
 * This is the one place in the app where something is written WITHOUT the user acting in
 * the moment — and it is permitted only because the user explicitly declared this bill:
 * they typed the name, the amount, and the day. AGENTS.md allows automation exactly for
 * "high-confidence and low-risk events", and a standing order the user configured is the
 * canonical case. Everything else still goes through Suggest → Confirm.
 *
 * Three properties this function must have, in order:
 *
 *   1. IDEMPOTENT. Today's screen calls it on every load. `lastPostedDate` is the guard:
 *      a bill already posted for its due date is never posted again, no matter how many
 *      times this runs.
 *   2. CATCHES UP. A user who did not open the app for six weeks has three missed rent
 *      charges, not one. It walks forward until the schedule is back in the future.
 *   3. HONEST. The posted expense is marked `source: 'inferred'` — the user declared a
 *      standing intention, they did not log this particular charge. If Netflix failed to
 *      bill them, the app was wrong, and that has to be visible and deletable.
 */
export async function postDueSubscriptions(user: AuthedUser): Promise<PostResult> {
  const today = todayLocalDate(user.timezone);

  const due = await SubscriptionModel.find({
    userId: new Types.ObjectId(user.id),
    archivedAt: null,
    nextDueDate: { $lte: today },
  });

  let posted = 0;
  let suggested = 0;

  for (const sub of due) {
    const cycle = sub.cycle as 'weekly' | 'monthly' | 'quarterly' | 'yearly';

    // Walk forward. A 6-week absence owes 1 rent, not 0 — and not 6.
    let guard = 0;
    while (sub.nextDueDate <= today && guard++ < 64) {
      const dueDate = sub.nextDueDate as LocalDate;

      // The idempotency guard. Today's screen calls this on every single load.
      if (sub.lastPostedDate === dueDate) break;

      if (sub.autoPost) {
        await expenses.createExpense(
          user,
          {
            amountMinor: sub.amountMinor,
            categoryId: sub.categoryId.toString(),
            merchant: sub.name,
            note: null,
            occurredAt: new Date(`${dueDate}T12:00:00Z`),
          },
          'subscription',
        );
        posted += 1;
      } else {
        // Not auto-posting: it becomes a question, on the same path as every other
        // inference. The unique (userId, detector, localDate) index dedupes it.
        const created = await InferredContextModel.updateOne(
          {
            userId: new Types.ObjectId(user.id),
            detector: `subscription:${sub._id.toString()}`,
            localDate: dueDate,
          },
          {
            $setOnInsert: {
              userId: new Types.ObjectId(user.id),
              detector: `subscription:${sub._id.toString()}`,
              localDate: dueDate,
              type: 'possible_expense',
              confidence: 0.95,
              title: `${sub.name} was due today`,
              description: 'Add it to your expenses?',
              evidence: [
                {
                  eventId: null,
                  label: `You set this up as a ${cycle} bill`,
                  weight: 1,
                },
              ],
              supportingEventIds: [],
              proposed: {
                kind: 'expense',
                amountMinor: sub.amountMinor,
                currency: sub.currency,
                merchant: sub.name,
                suggestedCategoryName: sub.categoryName,
              },
              status: 'pending',
              expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
              resolvedAt: null,
              correction: null,
            },
          },
          { upsert: true },
        );

        if (created.upsertedCount > 0) suggested += 1;
      }

      sub.lastPostedDate = dueDate;
      sub.nextDueDate = nextDueAfter(dueDate, cycle, sub.anchorDay, sub.anchorMonth ?? null);
    }

    await sub.save();
  }

  return { posted, suggested };
}
