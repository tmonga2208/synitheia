import {
  asMinor,
  currencyMeta,
  isLocalDate,
  startOfLocalDay,
  type DraftTransaction,
  type Minor,
} from '@synitheia/shared';
import { isUpiLensConfigured, type Env } from '../../config/env.js';

/**
 * UPI Lens API Client.
 *
 * Connects to the standalone upi-lens-api service (UPI_LENS_API_URL) for deterministic
 * parsing of bank account statements (PDF text, CSV, XLS, XLSX).
 *
 * Extracts dates, debit amounts, merchant names, UPI references (UTR/RRN), and categorizes
 * transactions without consuming LLM token budgets or suffering from LLM hallucination.
 */

/** Which reader upi-lens used: a known bank's PDF layout, a table, or its generic line reader. */
export type UpiLensLayout = 'SBI' | 'HDFC' | 'AXIS' | 'GENERIC' | 'TABLE';

export interface UpiLensResult {
  layout: UpiLensLayout;
  transactions: UpiLensTransaction[];
}

export interface UpiLensTransaction {
  date: string | null;
  description: string;
  amount: number;
  type: 'DEBIT' | 'CREDIT';
  currency: string;
  paymentMethod: string;
  merchant: string | null;
  category: string;
  confidence: 'low' | 'medium' | 'high' | string;
  reference?: string | null;
  balance?: number | null;
  sourceRow?: string;
}

export interface UpiLensResponse {
  success: boolean;
  layout?: UpiLensLayout;
  file?: { name: string; type: string; sizeBytes?: number };
  summary?: {
    transactionCount: number;
    totalDebits: number;
    totalCredits: number;
    upiCount: number;
  };
  transactions: UpiLensTransaction[];
  warnings?: string[];
}

/**
 * Map upi-lens-api category names to Synítheia system categories:
 * Food, Groceries, Transport, Shopping, Bills, Health, Entertainment.
 */
export function mapUpiLensCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const normalized = category.trim().toLowerCase();

  if (
    normalized.includes('food') ||
    normalized.includes('dining') ||
    normalized.includes('restaurant') ||
    normalized.includes('cafe')
  ) {
    return 'Food';
  }
  if (
    normalized.includes('grocer') ||
    normalized.includes('supermarket') ||
    normalized.includes('mart')
  ) {
    return 'Groceries';
  }
  if (
    normalized.includes('transport') ||
    normalized.includes('travel') ||
    normalized.includes('fuel') ||
    normalized.includes('cab') ||
    normalized.includes('auto') ||
    normalized.includes('metro')
  ) {
    return 'Transport';
  }
  if (
    normalized.includes('shopping') ||
    normalized.includes('retail') ||
    normalized.includes('ecommerce') ||
    normalized.includes('personal care') ||
    normalized.includes('clothing')
  ) {
    return 'Shopping';
  }
  if (
    normalized.includes('bill') ||
    normalized.includes('utilit') ||
    normalized.includes('recharge') ||
    normalized.includes('electricity') ||
    normalized.includes('water') ||
    normalized.includes('broadband') ||
    normalized.includes('dth') ||
    normalized.includes('investment') ||
    normalized.includes('insurance')
  ) {
    return 'Bills';
  }
  if (
    normalized.includes('health') ||
    normalized.includes('medical') ||
    normalized.includes('pharmacy') ||
    normalized.includes('doctor') ||
    normalized.includes('hospital')
  ) {
    return 'Health';
  }
  if (
    normalized.includes('entertainment') ||
    normalized.includes('movie') ||
    normalized.includes('game') ||
    normalized.includes('streaming') ||
    normalized.includes('ott')
  ) {
    return 'Entertainment';
  }

  return null;
}

/**
 * Translate qualitative confidence from upi-lens-api into numeric 0.0 - 1.0 confidence score.
 */
export function mapUpiLensConfidence(confidence: string): number {
  switch (confidence?.toLowerCase()) {
    case 'high':
      return 0.95;
    case 'medium':
      return 0.75;
    case 'low':
      return 0.5;
    default:
      return 0.75;
  }
}

function toMinor(amount: number, currency: string): Minor {
  const { decimals } = currencyMeta(currency);
  return asMinor(Math.round(amount * 10 ** decimals));
}

const NOON_MS = 12 * 60 * 60 * 1000;

/**
 * A statement gives a bare day ("2026-10-24"), not a moment. Read as UTC midnight it is
 * the previous evening anywhere west of Greenwich, so it is placed at noon in the user's
 * own timezone, which is that day everywhere.
 */
function parseDate(rawDate: string | null, timezone: string): Date | null {
  if (!rawDate) return null;
  if (isLocalDate(rawDate)) return new Date(startOfLocalDay(rawDate, timezone).getTime() + NOON_MS);
  const d = new Date(rawDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatEvidence(tx: UpiLensTransaction): string {
  const parts: string[] = [];
  if (tx.description) {
    parts.push(tx.description);
  }
  if (tx.reference) {
    parts.push(`[Ref: ${tx.reference}]`);
  }
  if (tx.paymentMethod && tx.paymentMethod !== 'UNKNOWN') {
    parts.push(`(${tx.paymentMethod})`);
  }
  return parts.join(' ').slice(0, 300);
}

/**
 * Normalizes a single transaction from upi-lens-api into a Synítheia DraftTransaction.
 * Credits (income) are returned as null — expenses must only contain debits.
 */
export function normalizeUpiLensTransaction(
  tx: UpiLensTransaction,
  fallbackCurrency: string,
  timezone: string,
): DraftTransaction | null {
  // Only debits are expenses. Income or salary credits must never become expenses.
  if (tx.type !== 'DEBIT' || typeof tx.amount !== 'number' || tx.amount <= 0) {
    return null;
  }

  const currency = tx.currency || fallbackCurrency;
  const occurredAt = parseDate(tx.date, timezone);

  return {
    amountMinor: toMinor(tx.amount, currency),
    currency,
    merchant: tx.merchant || (tx.paymentMethod === 'UPI' ? 'UPI Payment' : null),
    occurredAt,
    suggestedCategoryName: mapUpiLensCategory(tx.category),
    confidence: mapUpiLensConfidence(tx.confidence),
    evidence: formatEvidence(tx),
    duplicateOfExpenseId: null,
  };
}

/** The most drafts one statement may produce — the same ceiling the CSV reader keeps. */
const MAX_DRAFTS = 500;

/**
 * The drafts to file from a upi-lens parse, or null to let the model read the statement.
 *
 * Only `trusted` layouts are accepted: for a PDF that is a bank layout upi-lens knows,
 * because its generic line reader guesses at columns in a way the model does better.
 * A parse with no debits in it is also declined rather than reported as "nothing found".
 */
export function upiLensDrafts(
  result: UpiLensResult | null,
  user: { currency: string; timezone: string },
  trusted: readonly UpiLensLayout[],
): DraftTransaction[] | null {
  if (!result || !trusted.includes(result.layout)) return null;

  const drafts = result.transactions
    .map((tx) => normalizeUpiLensTransaction(tx, user.currency, user.timezone))
    .filter((d): d is DraftTransaction => d !== null)
    .slice(0, MAX_DRAFTS);

  return drafts.length > 0 ? drafts : null;
}

/** A parse should answer in about a second; a request that hangs must not hold up the upload. */
const TIMEOUT_MS = 10_000;

async function requestUpiLens(
  env: Env,
  path: string,
  body: string | FormData,
  headers?: Record<string, string>,
): Promise<UpiLensResult | null> {
  if (!isUpiLensConfigured(env)) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(new URL(path, env.UPI_LENS_API_URL).toString(), {
      method: 'POST',
      body,
      headers: env.UPI_LENS_API_KEY ? { ...headers, 'x-api-key': env.UPI_LENS_API_KEY } : headers,
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const data = (await response.json()) as UpiLensResponse;
    if (!data || !data.success || !Array.isArray(data.transactions)) return null;

    // A deployment from before `layout` existed cannot say which reader it used.
    return { layout: data.layout ?? 'GENERIC', transactions: data.transactions };
  } catch {
    // Unreachable, timed out, or not JSON: the caller falls back to the model.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Sends a spreadsheet or unlocked file to upi-lens-api. Null when it cannot help. */
export async function parseStatementWithUpiLens(
  env: Env,
  file: { buffer: Buffer; filename: string; mimeType: string },
): Promise<UpiLensResult | null> {
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.filename);
  return requestUpiLens(env, '/v1/statements/parse', formData);
}

/**
 * Sends a PDF statement's text, already opened here, to upi-lens-api. Bank statements are
 * usually locked, and the password stays on this server: only the opened text leaves it.
 */
export async function parseStatementTextWithUpiLens(env: Env, text: string): Promise<UpiLensResult | null> {
  return requestUpiLens(env, '/v1/statements/parse-text', JSON.stringify({ text }), {
    'content-type': 'application/json',
  });
}
