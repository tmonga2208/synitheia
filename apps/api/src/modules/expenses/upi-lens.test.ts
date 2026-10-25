import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import {
  mapUpiLensCategory,
  mapUpiLensConfidence,
  normalizeUpiLensTransaction,
  parseStatementWithUpiLens,
  type UpiLensTransaction,
} from './upi-lens.js';

describe('upi-lens category mapping', () => {
  it('maps dining and restaurant categories to Food', () => {
    expect(mapUpiLensCategory('Food & Dining')).toBe('Food');
    expect(mapUpiLensCategory('Restaurant')).toBe('Food');
    expect(mapUpiLensCategory('Cafe & Drinks')).toBe('Food');
  });

  it('maps grocery categories to Groceries', () => {
    expect(mapUpiLensCategory('Groceries')).toBe('Groceries');
    expect(mapUpiLensCategory('Supermarket')).toBe('Groceries');
  });

  it('maps travel, fuel, and transit to Transport', () => {
    expect(mapUpiLensCategory('Transport')).toBe('Transport');
    expect(mapUpiLensCategory('Travel & Flights')).toBe('Transport');
    expect(mapUpiLensCategory('Fuel / Petrol')).toBe('Transport');
  });

  it('maps retail and ecommerce to Shopping', () => {
    expect(mapUpiLensCategory('Shopping')).toBe('Shopping');
    expect(mapUpiLensCategory('Ecommerce')).toBe('Shopping');
  });

  it('maps utilities, recharges, and bills to Bills', () => {
    expect(mapUpiLensCategory('Bills')).toBe('Bills');
    expect(mapUpiLensCategory('Utilities')).toBe('Bills');
    expect(mapUpiLensCategory('Mobile Recharge')).toBe('Bills');
    expect(mapUpiLensCategory('Investment')).toBe('Bills');
  });

  it('maps medical and doctors to Health', () => {
    expect(mapUpiLensCategory('Health & Medical')).toBe('Health');
    expect(mapUpiLensCategory('Pharmacy')).toBe('Health');
  });

  it('maps movies and games to Entertainment', () => {
    expect(mapUpiLensCategory('Entertainment')).toBe('Entertainment');
    expect(mapUpiLensCategory('Movie Tickets')).toBe('Entertainment');
  });

  it('returns null for unmapped categories or null inputs', () => {
    expect(mapUpiLensCategory(null)).toBeNull();
    expect(mapUpiLensCategory(undefined)).toBeNull();
    expect(mapUpiLensCategory('Miscellaneous Unknown XYZ')).toBeNull();
  });
});

describe('upi-lens confidence mapping', () => {
  it('translates qualitative confidence ratings to bounded numeric values', () => {
    expect(mapUpiLensConfidence('high')).toBe(0.95);
    expect(mapUpiLensConfidence('medium')).toBe(0.75);
    expect(mapUpiLensConfidence('low')).toBe(0.5);
    expect(mapUpiLensConfidence('other')).toBe(0.75);
  });
});

describe('normalizeUpiLensTransaction', () => {
  const sampleTx: UpiLensTransaction = {
    date: '2026-10-24',
    description: 'UPI/ZOMATO/123456',
    amount: 320.5,
    type: 'DEBIT',
    currency: 'INR',
    paymentMethod: 'UPI',
    merchant: 'Zomato',
    category: 'Food & Dining',
    confidence: 'high',
    reference: '123456',
    balance: 12500,
  };

  it('converts a valid debit transaction into a DraftTransaction', () => {
    const draft = normalizeUpiLensTransaction(sampleTx, 'INR');
    expect(draft).not.toBeNull();
    expect(draft!.amountMinor).toBe(32050); // 320.50 INR in paise
    expect(draft!.currency).toBe('INR');
    expect(draft!.merchant).toBe('Zomato');
    expect(draft!.suggestedCategoryName).toBe('Food');
    expect(draft!.confidence).toBe(0.95);
    expect(draft!.evidence).toContain('UPI/ZOMATO/123456');
    expect(draft!.evidence).toContain('Ref: 123456');
    expect(draft!.occurredAt?.toISOString()).toContain('2026-10-24');
    expect(draft!.duplicateOfExpenseId).toBeNull();
  });

  it('discards CREDIT transactions so income is not treated as an expense', () => {
    const creditTx: UpiLensTransaction = {
      ...sampleTx,
      type: 'CREDIT',
      amount: 45000,
      description: 'SALARY ACME CORP',
    };
    expect(normalizeUpiLensTransaction(creditTx, 'INR')).toBeNull();
  });

  it('discards zero or negative amounts', () => {
    const zeroTx: UpiLensTransaction = { ...sampleTx, amount: 0 };
    const negTx: UpiLensTransaction = { ...sampleTx, amount: -100 };
    expect(normalizeUpiLensTransaction(zeroTx, 'INR')).toBeNull();
    expect(normalizeUpiLensTransaction(negTx, 'INR')).toBeNull();
  });

  it('handles fallback paymentMethod when merchant is absent', () => {
    const unnamedUpi: UpiLensTransaction = {
      ...sampleTx,
      merchant: null,
      paymentMethod: 'UPI',
    };
    const draft = normalizeUpiLensTransaction(unnamedUpi, 'INR');
    expect(draft!.merchant).toBe('UPI Payment');
  });
});

describe('parseStatementWithUpiLens', () => {
  const env = { UPI_LENS_API_URL: 'https://upi-lens-api.onrender.com' } as Env;
  const mockFile = {
    buffer: Buffer.from('test buffer content'),
    filename: 'statement.csv',
    mimeType: 'text/csv',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed transactions on successful 200 response', async () => {
    const mockResponseData = {
      success: true,
      transactions: [
        {
          date: '2026-10-24',
          description: 'UPI/UBER/987',
          amount: 250,
          type: 'DEBIT',
          currency: 'INR',
          paymentMethod: 'UPI',
          merchant: 'Uber',
          category: 'Transport',
          confidence: 'high',
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponseData,
    } as unknown as Response);

    const txs = await parseStatementWithUpiLens(env, mockFile);
    expect(txs).toHaveLength(1);
    expect(txs![0].merchant).toBe('Uber');
  });

  it('returns null when the API responds with non-200 error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ success: false }),
    } as unknown as Response);

    const txs = await parseStatementWithUpiLens(env, mockFile);
    expect(txs).toBeNull();
  });

  it('returns null on network failure or abort', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

    const txs = await parseStatementWithUpiLens(env, mockFile);
    expect(txs).toBeNull();
  });
});
