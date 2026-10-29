import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toLocalDate } from '@synitheia/shared';
import type { Env } from '../../config/env.js';
import {
  mapUpiLensCategory,
  mapUpiLensConfidence,
  normalizeUpiLensTransaction,
  parseStatementTextWithUpiLens,
  parseStatementWithUpiLens,
  upiLensDrafts,
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
    const draft = normalizeUpiLensTransaction(sampleTx, 'INR', 'Asia/Kolkata');
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

  it('files a statement date on that day wherever the user lives', () => {
    // A bare date read as UTC midnight is the previous evening west of Greenwich.
    for (const timezone of ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland']) {
      const draft = normalizeUpiLensTransaction(sampleTx, 'INR', timezone);
      expect(toLocalDate(draft!.occurredAt!, timezone)).toBe('2026-10-24');
    }
  });

  it('discards CREDIT transactions so income is not treated as an expense', () => {
    const creditTx: UpiLensTransaction = {
      ...sampleTx,
      type: 'CREDIT',
      amount: 45000,
      description: 'SALARY ACME CORP',
    };
    expect(normalizeUpiLensTransaction(creditTx, 'INR', 'Asia/Kolkata')).toBeNull();
  });

  it('discards zero or negative amounts', () => {
    const zeroTx: UpiLensTransaction = { ...sampleTx, amount: 0 };
    const negTx: UpiLensTransaction = { ...sampleTx, amount: -100 };
    expect(normalizeUpiLensTransaction(zeroTx, 'INR', 'Asia/Kolkata')).toBeNull();
    expect(normalizeUpiLensTransaction(negTx, 'INR', 'Asia/Kolkata')).toBeNull();
  });

  it('handles fallback paymentMethod when merchant is absent', () => {
    const unnamedUpi: UpiLensTransaction = {
      ...sampleTx,
      merchant: null,
      paymentMethod: 'UPI',
    };
    const draft = normalizeUpiLensTransaction(unnamedUpi, 'INR', 'Asia/Kolkata');
    expect(draft!.merchant).toBe('UPI Payment');
  });
});

describe('upiLensDrafts', () => {
  const user = { currency: 'INR', timezone: 'Asia/Kolkata' };
  const debit: UpiLensTransaction = {
    date: '2026-10-25',
    description: 'UPI/DR/111122223333/Ravi veg/YESB/Q123456789/NO R',
    amount: 75,
    type: 'DEBIT',
    currency: 'INR',
    paymentMethod: 'UPI',
    merchant: 'Ravi Veg',
    category: 'Groceries',
    confidence: 'high',
  };
  const credit: UpiLensTransaction = { ...debit, type: 'CREDIT', amount: 5000 };

  it('turns a recognised bank layout into drafts of its debits', () => {
    const drafts = upiLensDrafts({ layout: 'SBI', transactions: [debit, credit] }, user, ['SBI']);
    expect(drafts).toHaveLength(1);
    expect(drafts![0]).toMatchObject({ amountMinor: 7500, merchant: 'Ravi Veg', suggestedCategoryName: 'Groceries' });
  });

  it('declines the generic line reader, so the model reads layouts the parser does not know', () => {
    expect(upiLensDrafts({ layout: 'GENERIC', transactions: [debit] }, user, ['SBI'])).toBeNull();
  });

  it('declines a statement with no debits in it', () => {
    expect(upiLensDrafts({ layout: 'SBI', transactions: [credit] }, user, ['SBI'])).toBeNull();
  });

  it('declines when the parser could not be reached', () => {
    expect(upiLensDrafts(null, user, ['SBI'])).toBeNull();
  });
});

describe('parseStatementTextWithUpiLens', () => {
  const env = { UPI_LENS_API_URL: 'https://lens.example' } as Env;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the opened statement text as JSON to the parse-text endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, layout: 'SBI', transactions: [] }), { status: 200 }),
    );

    const result = await parseStatementTextWithUpiLens(env, 'statement text');

    expect(result).toEqual({ layout: 'SBI', transactions: [] });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://lens.example/v1/statements/parse-text');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ text: 'statement text' }) });
  });

  it('sends the shared key when one is configured, and none otherwise', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        new Response(JSON.stringify({ success: true, layout: 'SBI', transactions: [] }), { status: 200 }),
      );

    await parseStatementTextWithUpiLens({ ...env, UPI_LENS_API_KEY: 'k3y' } as Env, 'statement text');
    await parseStatementTextWithUpiLens(env, 'statement text');

    const headersOf = (call: number) => new Headers(fetchSpy.mock.calls[call]![1]!.headers);
    expect(headersOf(0).get('x-api-key')).toBe('k3y');
    expect(headersOf(1).has('x-api-key')).toBe(false);
  });

  it('makes no request when no parser is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(await parseStatementTextWithUpiLens({} as Env, 'statement text')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when the service refuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 422 }));

    expect(await parseStatementTextWithUpiLens(env, 'statement text')).toBeNull();
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
      layout: 'TABLE',
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

    const result = await parseStatementWithUpiLens(env, mockFile);
    expect(result!.layout).toBe('TABLE');
    expect(result!.transactions).toHaveLength(1);
    expect(result!.transactions[0]!.merchant).toBe('Uber');
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
