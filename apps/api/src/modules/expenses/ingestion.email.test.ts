import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The extractor is mocked: these tests prove routing/dedup/persistence, not the model.
vi.mock('../../ai/client.js', () => ({ callStructured: vi.fn() }));
import { callStructured } from '../../ai/client.js';
import { ingestEmail, recordLockedStatement, listPendingIngestions } from './ingestion.js';
import { ExpenseIngestionModel } from '../../db/models.js';
import type { Env } from '../../config/env.js';
import type { AuthedUser } from '../../core/auth-guard.js';

const env = {} as Env;
const user: AuthedUser = { id: '000000000000000000000001', timezone: 'Asia/Kolkata', currency: 'INR' };
const mocked = vi.mocked(callStructured);

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
  vi.clearAllMocks();
});

describe('ingestEmail', () => {
  it('persists a needs_review email ingestion with source and messageId', async () => {
    mocked.mockResolvedValue({
      transactions: [
        { amount: 450, currencyCode: 'INR', merchant: 'Blue Tokai', occurredAt: null,
          suggestedCategory: null, confidence: 0.9, evidence: 'Rs 450 debited', direction: 'debit' },
      ],
    });

    const rec = await ingestEmail(env, user, {
      messageId: '<m1@bank>', from: 'alerts@bank.example', subject: 'Debit alert', text: 'Rs 450 debited at Blue Tokai',
    });

    expect(rec).not.toBeNull();
    expect(rec!.channel).toBe('email');
    expect(rec!.status).toBe('needs_review');
    expect(rec!.drafts).toHaveLength(1);
    expect(rec!.messageId).toBe('<m1@bank>');
    expect((rec!.source as { subject: string }).subject).toBe('Debit alert');
  });

  it('is idempotent on messageId (retry returns null, one record)', async () => {
    mocked.mockResolvedValue({
      transactions: [
        { amount: 10, currencyCode: 'INR', merchant: null, occurredAt: null,
          suggestedCategory: null, confidence: 0.9, evidence: null, direction: 'debit' },
      ],
    });
    await ingestEmail(env, user, { messageId: '<dup@bank>', from: null, subject: null, text: 'Rs 10 debited' });
    const second = await ingestEmail(env, user, { messageId: '<dup@bank>', from: null, subject: null, text: 'Rs 10 debited' });
    expect(second).toBeNull();
    expect(await ExpenseIngestionModel.countDocuments({ channel: 'email' })).toBe(1);
  });

  it('throws ingestion_failed when the email holds no transaction', async () => {
    mocked.mockResolvedValue({ transactions: [] });
    await expect(
      ingestEmail(env, user, { messageId: '<promo@x>', from: null, subject: 'Sale!', text: 'Buy now' }),
    ).rejects.toMatchObject({ code: 'ingestion_failed' });
    expect(await ExpenseIngestionModel.countDocuments()).toBe(0);
  });
});

describe('recordLockedStatement + listPendingIngestions', () => {
  it('creates a needs_password record that shows up in the pending list', async () => {
    await recordLockedStatement(user, { from: 'e@bank', subject: 'Statement', receivedAt: new Date() }, '<s1@bank>');
    const pending = await listPendingIngestions(user.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('needs_password');
    expect(pending[0]!.drafts).toHaveLength(0);
  });

  it('is idempotent on messageId (a retried locked forward does not double-file)', async () => {
    const source = { from: 'e@bank', subject: 'Statement', receivedAt: new Date() };
    const first = await recordLockedStatement(user, source, '<locked-dup@bank>');
    const second = await recordLockedStatement(user, source, '<locked-dup@bank>');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(
      await ExpenseIngestionModel.countDocuments({ messageId: '<locked-dup@bank>' }),
    ).toBe(1);
  });
});
