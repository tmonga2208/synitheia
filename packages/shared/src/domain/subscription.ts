import { z } from 'zod';
import {
  currencySchema,
  isoInstantSchema,
  localDateSchema,
  minorAmountSchema,
  objectIdSchema,
} from './common.js';
import { addLocalDays, asLocalDate, type LocalDate } from '../time/local-date.js';

export const billingCycleSchema = z.enum(['weekly', 'monthly', 'quarterly', 'yearly']);
export type BillingCycle = z.infer<typeof billingCycleSchema>;

/**
 * A recurring bill the user has explicitly declared: Netflix, rent, the gym.
 *
 * Unlike everything else the app infers, a subscription is a FACT the user told us —
 * they typed the name, the amount, and the day. That is why it may post automatically
 * (see `autoPost`) where a detected lunch may not: the confidence is not a guess, it is
 * a statement. AGENTS.md permits automation exactly here — "high-confidence and low-risk
 * events may eventually support configurable automation" — and nowhere else.
 *
 * The posted expense is still marked `source: 'inferred'`, because the user did not log
 * *that particular charge*; they declared a standing intention. If Netflix fails to bill
 * them this month, the app was wrong, and it must be possible to see that and delete it.
 */
export const subscriptionSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,

  name: z.string().min(1).max(80),
  amountMinor: minorAmountSchema.positive(),
  currency: currencySchema,

  categoryId: objectIdSchema,
  categoryName: z.string(),
  categoryColor: z.string(),

  cycle: billingCycleSchema,

  /**
   * The day of the month it bills on (1–31), or the weekday for weekly (0=Mon).
   *
   * Stored as an ANCHOR, not as "the last date we posted". A subscription billed on the
   * 31st must charge on Feb 28 and then return to Mar 31 — computing the next date from
   * the last one instead makes it drift to the 28th permanently, and by June the user is
   * being billed on a day they never chose.
   */
  anchorDay: z.number().int().min(0).max(31),
  /** Which month of the cycle a yearly/quarterly bill lands in. 1 = January. */
  anchorMonth: z.number().int().min(1).max(12).nullable(),

  /** The next date this is expected to bill. Derived, stored for cheap querying. */
  nextDueDate: localDateSchema,
  /** The last date we actually posted an expense for. Guards against double-posting. */
  lastPostedDate: localDateSchema.nullable(),

  /**
   * When true, the charge posts itself on the due date. When false, it becomes a
   * suggestion the user confirms — the same Detect → Suggest → Confirm path as everything
   * else. Default true, because the user typed the amount themselves.
   */
  autoPost: z.boolean(),

  /** Paused, not deleted. A cancelled subscription's history is still the user's history. */
  archivedAt: isoInstantSchema.nullable(),

  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const createSubscriptionSchema = z.object({
  name: z.string().min(1).max(80),
  amountMinor: minorAmountSchema.positive(),
  categoryId: objectIdSchema,
  cycle: billingCycleSchema,
  anchorDay: z.number().int().min(0).max(31),
  anchorMonth: z.number().int().min(1).max(12).nullish(),
  /** Defaults to the next occurrence of the anchor, computed server-side. */
  nextDueDate: localDateSchema.optional(),
  autoPost: z.boolean().default(true),
});
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

export const updateSubscriptionSchema = createSubscriptionSchema.partial();
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

// ─── Date arithmetic ────────────────────────────────────────────────────────

function daysInMonth(year: number, month1: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function build(year: number, month1: number, day: number): LocalDate {
  return asLocalDate(`${year}-${pad(month1)}-${pad(day)}`);
}

/**
 * The date a monthly-style bill lands on in a given month.
 *
 * THE bug this exists to prevent: a subscription anchored on the 31st. February has no
 * 31st, so it must clamp to the 28th (or 29th) — but the anchor stays 31, so March
 * returns to the 31st. Code that computes "next month" from the *previous due date*
 * clamps once and then drifts forever: 31 Jan → 28 Feb → 28 Mar → 28 Apr, and the user
 * is now being billed on a day they never chose and cannot explain.
 */
export function dueDateIn(year: number, month1: number, anchorDay: number): LocalDate {
  const last = daysInMonth(year, month1);
  return build(year, month1, Math.min(anchorDay, last));
}

function addMonths(year: number, month1: number, months: number): [number, number] {
  const zero = year * 12 + (month1 - 1) + months;
  return [Math.floor(zero / 12), (zero % 12) + 1];
}

/**
 * The first due date strictly after `after`.
 *
 * Always derived from the anchor — never from the previous due date — so a clamped month
 * (Feb 28 for a 31st anchor) does not poison every month that follows.
 */
export function nextDueAfter(
  after: LocalDate,
  cycle: BillingCycle,
  anchorDay: number,
  anchorMonth: number | null,
): LocalDate {
  const [ys, ms, ds] = after.split('-').map(Number) as [number, number, number];

  if (cycle === 'weekly') {
    // anchorDay is a weekday here: 0 = Monday … 6 = Sunday.
    const weekday = (new Date(Date.UTC(ys, ms - 1, ds)).getUTCDay() + 6) % 7;
    const delta = ((anchorDay - weekday + 7) % 7) || 7;
    return addLocalDays(after, delta);
  }

  const step = cycle === 'monthly' ? 1 : cycle === 'quarterly' ? 3 : 12;

  // Yearly and quarterly bills are pinned to a month; monthly ones recur every month.
  const startMonth = anchorMonth ?? ms;

  let [y, m] = cycle === 'monthly' ? [ys, ms] : [ys, startMonth];

  for (let i = 0; i < 64; i++) {
    const candidate = dueDateIn(y, m, anchorDay);
    if (candidate > after) return candidate;
    [y, m] = addMonths(y, m, step);
  }

  // Unreachable for any sane input; a loop bound beats an infinite one.
  throw new RangeError('Could not find a next due date');
}

/**
 * What a subscription costs per month, so a mixed list of weekly/yearly bills can be
 * added up into one honest number.
 *
 * Weekly is 52/12 weeks per month, not 4 — "4 weeks a month" quietly under-reports an
 * annual cost by a full month's worth (4 × 12 = 48 weeks, not 52).
 */
export function monthlyEquivalent(amountMinor: number, cycle: BillingCycle): number {
  switch (cycle) {
    case 'weekly':
      return Math.round((amountMinor * 52) / 12);
    case 'monthly':
      return amountMinor;
    case 'quarterly':
      return Math.round(amountMinor / 3);
    case 'yearly':
      return Math.round(amountMinor / 12);
  }
}

export const CYCLE_LABEL: Record<BillingCycle, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  yearly: 'Yearly',
};
