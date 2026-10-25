import { asMinor, currencyMeta, type DraftTransaction, type Minor } from '@synitheia/shared';
import type { Env } from '../../config/env.js';

/**
 * UPI Lens API Client.
 *
 * Connects to the standalone upi-lens-api service (https://upi-lens-api.onrender.com)
 * for high-speed, deterministic parsing of bank account statements (PDF, CSV, XLS, XLSX).
 *
 * Extracts dates, debit amounts, merchant names, UPI references (UTR/RRN), and categorizes
 * transactions without consuming LLM token budgets or suffering from LLM hallucination.
 */

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

function parseDate(rawDate: string | null): Date | null {
  if (!rawDate) return null;
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
): DraftTransaction | null {
  // Only debits are expenses. Income or salary credits must never become expenses.
  if (tx.type !== 'DEBIT' || typeof tx.amount !== 'number' || tx.amount <= 0) {
    return null;
  }

  const currency = tx.currency || fallbackCurrency;
  const occurredAt = parseDate(tx.date);

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

/**
 * Sends a bank statement buffer to upi-lens-api for tabular/regex statement parsing.
 * Returns null if the service is unreachable or parsing encounters an error.
 */
export async function parseStatementWithUpiLens(
  env: Env,
  file: { buffer: Buffer; filename: string; mimeType: string },
): Promise<UpiLensTransaction[] | null> {
  const baseUrl = env?.UPI_LENS_API_URL || 'https://upi-lens-api.onrender.com';
  const url = new URL('/v1/statements/parse', baseUrl);

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimeType });
  formData.append('file', blob, file.filename);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000); // 20s timeout for cold start

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as UpiLensResponse;
    if (!data || !data.success || !Array.isArray(data.transactions)) {
      return null;
    }

    return data.transactions;
  } catch {
    // If the network request fails, timeout fires, or payload is invalid, return null to fall back
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
