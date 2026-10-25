import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The model is mocked: these tests prove which reader a statement goes to, not the model.
vi.mock('../../ai/client.js', () => ({ callStructured: vi.fn() }));
import { callStructured } from '../../ai/client.js';
import { ingestPdf } from './ingestion.js';
import { ExpenseIngestionModel } from '../../db/models.js';
import type { Env } from '../../config/env.js';
import type { AuthedUser } from '../../core/auth-guard.js';

const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)));

/** The fixtures are the same statement, one locked with this password and one not. */
const PASSWORD = 'TARU2208';

const env = { UPI_LENS_API_URL: 'https://lens.example' } as Env;
const user: AuthedUser = { id: '000000000000000000000001', timezone: 'Asia/Kolkata', currency: 'INR' };
const model = vi.mocked(callStructured);

const lensDebit = {
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

function lensReplies(body: object) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}

let mongo: MongoMemoryReplSet;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await ExpenseIngestionModel.syncIndexes();
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
afterEach(async () => {
  await ExpenseIngestionModel.deleteMany({});
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('ingestPdf with upi-lens', () => {
  it("sends a locked statement's opened text, not the file, and files what a known layout reads", async () => {
    const fetchSpy = lensReplies({ success: true, layout: 'SBI', transactions: [lensDebit] });

    const rec = await ingestPdf(env, user, fixture('statement-locked.pdf'), PASSWORD);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://lens.example/v1/statements/parse-text');
    expect(String(init!.body)).not.toContain(PASSWORD);
    expect((JSON.parse(String(init!.body)) as { text: string }).text.trim().length).toBeGreaterThan(0);

    expect(rec.drafts).toHaveLength(1);
    expect(rec.drafts[0]).toMatchObject({ merchant: 'Ravi Veg', suggestedCategoryName: 'Groceries', amountMinor: 7500 });
    expect(model).not.toHaveBeenCalled();
  });

  it('lets the model read a statement upi-lens could only guess at', async () => {
    lensReplies({ success: true, layout: 'GENERIC', transactions: [lensDebit] });
    model.mockResolvedValue({
      transactions: [
        { amount: 75, currencyCode: 'INR', merchant: 'Ravi Vegetables', occurredAt: null,
          suggestedCategory: 'Groceries', confidence: 0.9, evidence: 'Ravi veg', direction: 'debit' },
      ],
    });

    const rec = await ingestPdf(env, user, fixture('statement-locked.pdf'), PASSWORD);

    expect(model).toHaveBeenCalledOnce();
    expect(rec.drafts[0]).toMatchObject({ merchant: 'Ravi Vegetables' });
  });
});
