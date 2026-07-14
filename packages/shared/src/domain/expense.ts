import { z } from 'zod';
import {
  confidenceSchema,
  currencySchema,
  dataSourceSchema,
  isoInstantSchema,
  localDateSchema,
  minorAmountSchema,
  objectIdSchema,
  timeZoneSchema,
} from './common.js';

export const expenseCategorySchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  name: z.string().min(1).max(40),
  icon: z.string().min(1), //  lucide icon name
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  isSystem: z.boolean(),
  createdAt: isoInstantSchema,
});
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

// ─── Splitting ──────────────────────────────────────────────────────────────
//
// Two things can happen at a shared dinner, and an expense tracker has to hold both.
//
//   YOU PAID.        The bill was ₹1,000, you put it on your card, three friends owe you
//                    ₹250 each. amountMinor is ₹1,000 — you are out the whole thing until
//                    they pay you back.
//
//   SOMEONE ELSE PAID. The bill was ₹1,000, Ana paid it, your share is ₹250. amountMinor
//                    is ₹250. You never had ₹1,000; recording it would be a lie, and it
//                    would quadruple your Friday spending on a meal you barely paid for.
//
// The rule that unifies them, and the one to remember:
//
//     amountMinor is always what YOU are out. Never the bill.
//
// `billAmountMinor` keeps the total for context ("your ₹250 of ₹1,000"), and `paidBy`
// records who actually settled with the restaurant.
//
// netMinor then means the same thing in both cases: what it has actually cost you, after
// money that has genuinely come back.

/**
 * One person who owes you part of an expense.
 *
 * Only the people the user explicitly picked are stored, and only their name. We never
 * upload a contact book — see the note on the contacts picker in the app. `contactId` is
 * the device-local identifier, kept so the same person can be recognised across expenses
 * without us holding a phone number we have no use for.
 */
export const participantSchema = z.object({
  name: z.string().min(1).max(80),
  /** Device-local contact id. Null when the name was typed by hand. */
  contactId: z.string().max(120).nullable(),
  shareMinor: minorAmountSchema.nonnegative(),
  /** When they paid you back. Null means they still owe you. */
  settledAt: isoInstantSchema.nullable(),
});
export type Participant = z.infer<typeof participantSchema>;

export const expenseSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,

  /** Integer minor units. Never a float. See money.ts for why this is non-negotiable. */
  amountMinor: minorAmountSchema.positive(),
  currency: currencySchema,

  categoryId: objectIdSchema,
  /**
   * Category name and color are denormalized onto every expense.
   *
   * The expense list renders hundreds of rows and must not N+1 or join to paint a
   * chip. Renaming a category triggers a backfill; that is the accepted cost of a
   * list that scrolls at 60fps. The categoryId remains the source of truth.
   */
  categoryName: z.string(),
  categoryColor: z.string(),

  merchant: z.string().max(120).nullable(),
  note: z.string().max(500).nullable(),

  occurredAt: isoInstantSchema,
  timezone: timeZoneSchema,
  localDate: localDateSchema,

  source: dataSourceSchema,
  /** Set only when this expense originated from an ingested draft. */
  ingestionId: objectIdSchema.nullable(),

  /**
   * Who paid the venue. Null means you did.
   *
   * When someone else paid, `amountMinor` is YOUR SHARE and `participants` is empty —
   * nobody owes you anything, because you did not front the money.
   */
  paidBy: z
    .object({
      name: z.string().min(1).max(80),
      contactId: z.string().max(120).nullable(),
    })
    .nullable()
    .default(null),

  /** The full bill, when it was bigger than your share. Null when you paid it all. */
  billAmountMinor: minorAmountSchema.positive().nullable().default(null),

  /**
   * People who owe YOU. Only ever populated when you were the one who paid — if Ana
   * covered the bill, she owes you nothing.
   */
  participants: z.array(participantSchema).max(30).default([]),

  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});
export type Expense = z.infer<typeof expenseSchema>;

/** What has been paid back to you so far. */
export function settledMinor(participants: readonly Participant[]): number {
  return participants
    .filter((p) => p.settledAt !== null)
    .reduce((acc, p) => acc + p.shareMinor, 0);
}

/** What is still owed to you. */
export function owedMinor(participants: readonly Participant[]): number {
  return participants
    .filter((p) => p.settledAt === null)
    .reduce((acc, p) => acc + p.shareMinor, 0);
}

/**
 * What this expense actually cost you: what you paid, minus what has come back.
 *
 * Note what this does NOT do: it does not subtract what people still *owe*. An IOU is not
 * money in your pocket. Until your friend actually pays you, that ₹250 is money you are
 * out — and a tracker that pretended otherwise would flatter your spending with cash you
 * have not been given.
 */
export function netMinor(expense: Pick<Expense, 'amountMinor' | 'participants'>): number {
  return Math.max(0, expense.amountMinor - settledMinor(expense.participants));
}

export const createExpenseSchema = z.object({
  amountMinor: minorAmountSchema.positive(),
  categoryId: objectIdSchema,
  merchant: z.string().max(120).nullish(),
  note: z.string().max(500).nullish(),
  occurredAt: isoInstantSchema.optional(),
  ingestionId: objectIdSchema.nullish(),

  paidBy: z
    .object({
      name: z.string().min(1).max(80),
      contactId: z.string().max(120).nullish(),
    })
    .nullish(),
  billAmountMinor: minorAmountSchema.positive().nullish(),

  participants: z
    .array(
      participantSchema.omit({ settledAt: true }).extend({
        settledAt: isoInstantSchema.nullish(),
      }),
    )
    .max(30)
    .optional(),
})
  .superRefine((input, ctx) => {
    // Your share cannot exceed the bill. Catching it here beats storing a nonsense row.
    if (input.billAmountMinor != null && input.amountMinor > input.billAmountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amountMinor'],
        message: 'Your share cannot be more than the total bill',
      });
    }

    // If someone else paid, nobody owes YOU — you never fronted the money.
    if (input.paidBy && (input.participants?.length ?? 0) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participants'],
        message: 'Nobody owes you when someone else paid the bill',
      });
    }
  });
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema.innerType().partial();
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

// ─── Ingestion ──────────────────────────────────────────────────────────────
//
// Platforms will not give us transaction data: iOS exposes no SMS or notification
// access at all, and Play Store policy restricts READ_SMS to default SMS handlers.
// So the user hands it to us instead — a shared payment screenshot, a pasted
// transaction SMS, a statement PDF or CSV. This is legal, cross-platform, works via
// the share sheet in two taps, and is more honest than a background scraper.
//
// Every channel produces a DRAFT with a confidence score. A draft is never an
// expense until the user confirms it: Detect → Infer → Suggest → Confirm.

export const ingestionChannelSchema = z.enum(['screenshot', 'text', 'pdf', 'csv']);
export type IngestionChannel = z.infer<typeof ingestionChannelSchema>;

export const ingestionStatusSchema = z.enum([
  'parsing',
  'needs_review', //  parsed; waiting for the user
  'confirmed',
  'rejected',
  'failed',
]);
export type IngestionStatus = z.infer<typeof ingestionStatusSchema>;

/**
 * One candidate transaction extracted from an ingested artifact.
 * A CSV or PDF statement yields many; a screenshot or SMS usually yields one.
 */
export const draftTransactionSchema = z.object({
  amountMinor: minorAmountSchema,
  currency: currencySchema,
  merchant: z.string().nullable(),
  occurredAt: isoInstantSchema.nullable(),
  /** The extractor's category guess, resolved to a real id at confirm time. */
  suggestedCategoryName: z.string().nullable(),
  confidence: confidenceSchema,
  /** The exact source substring this was read from — shown to the user so they can check our work. */
  evidence: z.string().nullable(),
  /** Set when this transaction matches an expense the user already has. */
  duplicateOfExpenseId: objectIdSchema.nullable(),
});
export type DraftTransaction = z.infer<typeof draftTransactionSchema>;

export const expenseIngestionSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  channel: ingestionChannelSchema,
  status: ingestionStatusSchema,
  drafts: z.array(draftTransactionSchema),
  /** Why parsing failed, shown verbatim to the user rather than a generic error. */
  error: z.string().nullable(),
  createdAt: isoInstantSchema,
  expiresAt: isoInstantSchema,
});
export type ExpenseIngestion = z.infer<typeof expenseIngestionSchema>;

export const SYSTEM_CATEGORIES = [
  { name: 'Food', icon: 'utensils', color: '#C08A7D' },
  { name: 'Groceries', icon: 'shopping-basket', color: '#7D927D' },
  { name: 'Transport', icon: 'bus', color: '#7D8FA9' },
  { name: 'Shopping', icon: 'shopping-bag', color: '#A98D7D' },
  { name: 'Bills', icon: 'receipt', color: '#8A8A8A' },
  { name: 'Health', icon: 'heart-pulse', color: '#B08A8A' },
  { name: 'Entertainment', icon: 'clapperboard', color: '#9A8AA9' },
  { name: 'Other', icon: 'circle-dashed', color: '#A3A3A0' },
] as const;
