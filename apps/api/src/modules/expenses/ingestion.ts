import { parse as parseCsvSync } from 'csv-parse/sync';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  SYSTEM_CATEGORIES,
  asMinor,
  currencyMeta,
  type DraftTransaction,
  type IngestionChannel,
  type Minor,
} from '@synitheia/shared';
import { AppError } from '../../core/errors.js';
import { ExpenseIngestionModel, ExpenseModel } from '../../db/models.js';
import { callStructured, type AiContent } from '../../ai/client.js';
import type { Env } from '../../config/env.js';
import type { AuthedUser } from '../../core/auth-guard.js';

/**
 * Expense ingestion.
 *
 * The product brief wanted automatic transaction capture. The platforms will not
 * allow it: iOS exposes no SMS or notification access at all, and Play Store policy
 * restricts READ_SMS to default SMS handler apps — "finance tracking" is not an
 * approvable use case, and shipping it would risk the app being pulled. UPI has no
 * public API; the lawful route in India is the RBI Account Aggregator framework,
 * which requires a registered FIU partner.
 *
 * So the user hands us the data instead: they share the payment screenshot, paste the
 * transaction SMS, or upload a statement. This is strictly better than a scraper —
 * it works on iOS, needs no restricted permission, and every transaction arrives with
 * the user's explicit, per-item consent, which is exactly the posture the brief
 * demands elsewhere.
 *
 * Everything here produces DRAFTS. A draft is never an expense until the user
 * confirms it: Detect → Infer → Suggest → Confirm.
 */

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What the extractor must return. Enforced, not requested. */
const extractionSchema = z.object({
  transactions: z
    .array(
      z.object({
        /** Major units as the model reads them — "250.00". Converted to minor below. */
        amount: z.number().nonnegative(),
        currencyCode: z.string().length(3).nullable(),
        merchant: z.string().nullable(),
        /** ISO-8601, or null when the artifact does not say. */
        occurredAt: z.string().nullable(),
        suggestedCategory: z.string().nullable(),
        confidence: z.number().min(0).max(1),
        evidence: z.string().nullable(),
        /**
         * Credits must be distinguishable from debits. A ₹5,000 salary credit parsed
         * as a ₹5,000 expense would be a spectacular way to destroy a user's month.
         */
        direction: z.enum(['debit', 'credit']),
      }),
    )
    .max(200),
});

const EXTRACTION_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Amount in major units, e.g. 250.50' },
          currencyCode: {
            type: ['string', 'null'],
            description: 'ISO 4217 code, e.g. INR. Null if not shown.',
          },
          merchant: { type: ['string', 'null'] },
          occurredAt: {
            type: ['string', 'null'],
            description: 'ISO-8601 timestamp. Null if the source does not state one.',
          },
          suggestedCategory: {
            type: ['string', 'null'],
            description: `One of: ${SYSTEM_CATEGORIES.map((c) => c.name).join(', ')}`,
          },
          confidence: {
            type: 'number',
            description:
              'Your certainty this is a real transaction read correctly, 0 to 1. Be honest; a low score is far better than a wrong expense.',
          },
          evidence: {
            type: ['string', 'null'],
            description: 'The exact text you read this from, so the user can check it.',
          },
          direction: {
            type: 'string',
            enum: ['debit', 'credit'],
            description: 'debit = money left the account. credit = money came in.',
          },
        },
        required: ['amount', 'confidence', 'direction'],
      },
    },
  },
  required: ['transactions'],
};

const EXTRACTION_SYSTEM = `You extract payment transactions from artifacts a user has explicitly shared: a payment app screenshot, a transaction SMS, or a bank statement.

Rules:
- Extract ONLY transactions actually present. Never infer, complete, or invent one. If the artifact contains no transaction, return an empty array.
- Report the amount exactly as written. Do not convert currencies, apply fees, or round.
- Mark money leaving the account as "debit" and money arriving as "credit". Getting this backwards turns a salary credit into a five-thousand-rupee expense, so check it.
- Set confidence honestly. A blurry screenshot, an ambiguous amount, or a truncated SMS deserves a low score. An unreviewed wrong expense is far more damaging than a suggestion the user has to correct.
- Put the exact source text in "evidence" so the user can verify your reading.
- If the artifact shows a date, use it. If it does not, return null rather than guessing today.`;

function toMinor(amount: number, currency: string): Minor {
  const { decimals } = currencyMeta(currency);
  // Round at the boundary, once. The model speaks in major units; everything
  // downstream is integer minor units.
  return asMinor(Math.round(amount * 10 ** decimals));
}

function normalizeCategory(suggested: string | null): string | null {
  if (!suggested) return null;
  const match = SYSTEM_CATEGORIES.find(
    (c) => c.name.toLowerCase() === suggested.toLowerCase().trim(),
  );
  return match?.name ?? null;
}

/**
 * Flag drafts that duplicate an expense the user already has.
 *
 * The realistic failure: a user shares the GPay screenshot AND later imports the bank
 * statement covering the same day. Without this, they get charged twice in their own
 * records. Matched on same amount within a 24h window — tight enough to avoid false
 * positives on genuine repeat purchases at the same shop, loose enough to catch the
 * statement's settlement date differing from the payment date.
 */
async function markDuplicates(
  userId: string,
  drafts: DraftTransaction[],
): Promise<DraftTransaction[]> {
  const dated = drafts.filter((d) => d.occurredAt !== null);
  if (dated.length === 0) return drafts;

  const timestamps = dated.map((d) => d.occurredAt!.getTime());
  const windowMs = 24 * 60 * 60 * 1000;

  const candidates = await ExpenseModel.find(
    {
      userId: new Types.ObjectId(userId),
      amountMinor: { $in: dated.map((d) => d.amountMinor) },
      occurredAt: {
        $gte: new Date(Math.min(...timestamps) - windowMs),
        $lte: new Date(Math.max(...timestamps) + windowMs),
      },
    },
    { amountMinor: 1, occurredAt: 1 },
  ).lean();

  return drafts.map((draft) => {
    if (!draft.occurredAt) return draft;
    const hit = candidates.find(
      (c) =>
        c.amountMinor === draft.amountMinor &&
        Math.abs(c.occurredAt.getTime() - draft.occurredAt!.getTime()) <= windowMs,
    );
    return hit
      ? { ...draft, duplicateOfExpenseId: hit._id.toString() }
      : draft;
  });
}

async function extract(
  env: Env,
  content: AiContent[],
  fallbackCurrency: string,
): Promise<DraftTransaction[]> {
  const result = await callStructured({
    env,
    system: EXTRACTION_SYSTEM,
    content,
    outputName: 'record_transactions',
    outputDescription: 'The transactions found in the shared artifact.',
    schema: EXTRACTION_TOOL_SCHEMA,
    outputSchema: extractionSchema,
    maxTokens: 4096,
  });

  return (
    result.transactions
      // Credits are not expenses. Dropping them here rather than storing them as
      // negative amounts keeps the Expense collection meaning one thing.
      .filter((t) => t.direction === 'debit' && t.amount > 0)
      .map((t) => {
        const currency = t.currencyCode ?? fallbackCurrency;
        const occurredAt = t.occurredAt ? new Date(t.occurredAt) : null;

        return {
          amountMinor: toMinor(t.amount, currency),
          currency,
          merchant: t.merchant,
          // A model can emit a syntactically valid but nonsense date; refuse it rather
          // than filing an expense in 1970.
          occurredAt:
            occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
          suggestedCategoryName: normalizeCategory(t.suggestedCategory),
          confidence: t.confidence,
          evidence: t.evidence,
          duplicateOfExpenseId: null,
        } satisfies DraftTransaction;
      })
  );
}

export async function ingestScreenshot(
  env: Env,
  user: AuthedUser,
  image: { base64: string; mediaType: string },
) {
  const supported = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!supported.includes(image.mediaType)) {
    throw AppError.ingestionFailed(
      `Unsupported image type "${image.mediaType}". Use JPEG, PNG, WebP, or GIF.`,
    );
  }

  return runIngestion(env, user, 'screenshot', [
    { type: 'image', mediaType: image.mediaType, base64: image.base64 },
    {
      type: 'text',
      text: 'Extract every payment transaction visible in this screenshot.',
    },
  ]);
}

export async function ingestText(env: Env, user: AuthedUser, text: string) {
  if (text.trim().length === 0) {
    throw AppError.ingestionFailed('Nothing to read — the text was empty.');
  }

  return runIngestion(env, user, 'text', [
    {
      type: 'text',
      text: `Extract every payment transaction from this text (typically a bank or UPI notification):\n\n${text.slice(0, 8000)}`,
    },
  ]);
}

export async function ingestPdf(env: Env, user: AuthedUser, buffer: Buffer) {
  // pdf-parse is CJS-only and pulls in a large dependency tree; importing it lazily
  // keeps it out of the hot path for every request that is not a PDF upload.
  const { default: pdfParse } = await import('pdf-parse');

  let text: string;
  try {
    const parsed = await pdfParse(buffer);
    text = parsed.text;
  } catch {
    throw AppError.ingestionFailed('That PDF could not be read. It may be encrypted.');
  }

  if (text.trim().length === 0) {
    throw AppError.ingestionFailed(
      'That PDF contains no selectable text — it may be a scan. Try sharing it as a screenshot instead.',
    );
  }

  return runIngestion(env, user, 'pdf', [
    {
      type: 'text',
      text: `Extract every transaction from this bank/card statement:\n\n${text.slice(0, 60_000)}`,
    },
  ]);
}

/**
 * CSV is parsed deterministically, without the model.
 *
 * A CSV already has structure — columns, rows, types. Handing it to an LLM would be
 * spending money and latency to make a solved problem probabilistic. The model earns
 * its keep on screenshots and free-text SMS, where there is genuinely no parser.
 */
export async function ingestCsv(user: AuthedUser, csv: string) {
  let rows: Record<string, string>[];
  try {
    rows = parseCsvSync(csv, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });
  } catch (err) {
    throw AppError.ingestionFailed(
      `That CSV could not be parsed: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }

  const pick = (row: Record<string, string>, keys: string[]): string | null => {
    for (const key of keys) {
      const value = row[key];
      if (value != null && value !== '') return value;
    }
    return null;
  };

  const drafts: DraftTransaction[] = [];

  for (const row of rows.slice(0, 500)) {
    const rawDebit = pick(row, ['debit', 'withdrawal', 'withdrawal amount', 'paid out']);
    const rawAmount = rawDebit ?? pick(row, ['amount', 'value', 'transaction amount']);
    if (!rawAmount) continue;

    const numeric = Number(rawAmount.replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(numeric) || numeric === 0) continue;

    // A statement may encode a debit either in a dedicated column or as a negative
    // in a signed "amount" column. Credits are not expenses; skip them.
    const isDebit = rawDebit !== null || numeric < 0;
    if (!isDebit) continue;

    const rawDate = pick(row, ['date', 'transaction date', 'value date', 'posted']);
    const parsedDate = rawDate ? new Date(rawDate) : null;

    drafts.push({
      amountMinor: toMinor(Math.abs(numeric), user.currency),
      currency: user.currency,
      merchant:
        pick(row, ['description', 'narration', 'merchant', 'details', 'particulars']) ??
        null,
      occurredAt:
        parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
      suggestedCategoryName: null,
      // Deterministic parse of structured data — but the column headings were guessed,
      // so this is high confidence, not certainty. The user still confirms.
      confidence: 0.9,
      evidence: Object.values(row).filter(Boolean).join(' · ').slice(0, 200),
      duplicateOfExpenseId: null,
    });
  }

  if (drafts.length === 0) {
    throw AppError.ingestionFailed(
      'No debit transactions were found in that CSV. Check that it has an amount or debit column.',
    );
  }

  return persist(user, 'csv', await markDuplicates(user.id, drafts));
}

async function runIngestion(
  env: Env,
  user: AuthedUser,
  channel: IngestionChannel,
  content: AiContent[],
) {
  const drafts = await extract(env, content, user.currency);

  if (drafts.length === 0) {
    throw AppError.ingestionFailed(
      'No transaction was found. If this is a payment confirmation, try a clearer screenshot.',
    );
  }

  return persist(user, channel, await markDuplicates(user.id, drafts));
}

async function persist(
  user: AuthedUser,
  channel: IngestionChannel,
  drafts: DraftTransaction[],
) {
  return ExpenseIngestionModel.create({
    userId: new Types.ObjectId(user.id),
    channel,
    status: 'needs_review',
    drafts,
    error: null,
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
  });
}

export async function getIngestion(userId: string, id: string) {
  const doc = await ExpenseIngestionModel.findOne({
    _id: new Types.ObjectId(id),
    userId: new Types.ObjectId(userId),
  }).lean();

  if (!doc) throw AppError.notFound('Ingestion');
  return doc;
}

export async function listPendingIngestions(userId: string) {
  return ExpenseIngestionModel.find({
    userId: new Types.ObjectId(userId),
    status: 'needs_review',
  })
    .sort({ createdAt: -1 })
    .lean();
}

export async function rejectIngestion(userId: string, id: string) {
  const result = await ExpenseIngestionModel.updateOne(
    { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
    { $set: { status: 'rejected' } },
  );

  if (result.matchedCount === 0) throw AppError.notFound('Ingestion');
}

export async function markIngestionConfirmed(userId: string, id: string) {
  await ExpenseIngestionModel.updateOne(
    { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
    { $set: { status: 'confirmed' } },
  );
}
