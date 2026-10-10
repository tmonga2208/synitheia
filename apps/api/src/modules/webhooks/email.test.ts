import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseInboundPayload } from './email.js';

const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`../expenses/__fixtures__/${name}`, import.meta.url)));

describe('parseInboundPayload', () => {
  it('prefers text, falls back to stripped HTML', () => {
    expect(parseInboundPayload({ to: 'x', text: '  Rs 10 debited ' }).text).toBe('Rs 10 debited');
    const fromHtml = parseInboundPayload({
      to: 'x',
      html: '<style>a{}</style><p>Rs&nbsp;20 <b>debited</b></p>',
    });
    expect(fromHtml.text).toBe('Rs 20 debited');
  });

  it('keeps only PDF attachments with content, decoded to buffers', () => {
    const b64 = Buffer.from('%PDF-1.4 fake').toString('base64');
    const out = parseInboundPayload({
      to: 'x',
      attachments: [
        { filename: 'statement.pdf', contentType: 'application/pdf', contentBase64: b64 },
        { filename: 'logo.png', contentType: 'image/png', contentBase64: b64 },
        { filename: 'empty.pdf', contentType: 'application/pdf' },
      ],
    });
    expect(out.pdfAttachments).toHaveLength(1);
    expect(out.pdfAttachments[0]!.filename).toBe('statement.pdf');
    expect(out.pdfAttachments[0]!.buffer.toString()).toBe('%PDF-1.4 fake');
  });
});

vi.mock('../../ai/client.js', () => ({ callStructured: vi.fn() }));
import { callStructured } from '../../ai/client.js';
import { handleInboundEmail } from './email.js';
import { UserModel, ExpenseIngestionModel } from '../../db/models.js';
import { getOrCreateInbox } from '../expenses/inbox.js';
import type { Env } from '../../config/env.js';

const env = { INBOUND_DOMAIN: 'in.example.app' } as Env;
const mocked = vi.mocked(callStructured);

let mongo: MongoMemoryReplSet;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await UserModel.syncIndexes();
  await ExpenseIngestionModel.syncIndexes();
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
afterEach(async () => {
  await UserModel.deleteMany({});
  await ExpenseIngestionModel.deleteMany({});
  vi.clearAllMocks();
});

describe('handleInboundEmail', () => {
  async function seedInbox() {
    const u = await UserModel.create({
      name: 'A',
      email: 'a@x.com',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });
    const { address } = await getOrCreateInbox(env, u._id.toString());
    return { u, address };
  }

  it('files a draft from a forwarded alert email', async () => {
    const { address } = await seedInbox();
    mocked.mockResolvedValue({
      transactions: [
        {
          amount: 450,
          currencyCode: 'INR',
          merchant: 'Blue Tokai',
          occurredAt: null,
          suggestedCategory: null,
          confidence: 0.9,
          evidence: 'Rs 450',
          direction: 'debit',
        },
      ],
    });
    await handleInboundEmail(env, {
      to: address,
      from: 'alerts@bank',
      subject: 'Debit',
      text: 'Rs 450 debited',
      messageId: '<m@bank>',
    });
    expect(
      await ExpenseIngestionModel.countDocuments({ channel: 'email', status: 'needs_review' }),
    ).toBe(1);
  });

  it('drops mail to an unknown token without creating anything', async () => {
    await seedInbox();
    await handleInboundEmail(env, {
      to: 'inbox-' + 'f'.repeat(32) + '@in.example.app',
      text: 'Rs 10 debited',
    });
    expect(await ExpenseIngestionModel.countDocuments()).toBe(0);
  });

  it('records a locked statement when a PDF attachment needs a password', async () => {
    const { address } = await seedInbox();
    const b64 = fixture('statement-locked.pdf').toString('base64');

    await handleInboundEmail(env, {
      to: address,
      from: 'estatements@bank',
      subject: 'Your statement',
      messageId: '<locked1@bank>',
      attachments: [
        { filename: 'statement.pdf', contentType: 'application/pdf', contentBase64: b64 },
      ],
    });

    const rec = await ExpenseIngestionModel.findOne({ channel: 'email', status: 'needs_password' })
      .lean();
    expect(rec).not.toBeNull();
    expect(rec!.messageId).toBe('<locked1@bank>');
  });

  it('is idempotent on messageId for a retried locked-statement forward', async () => {
    const { address } = await seedInbox();
    const b64 = fixture('statement-locked.pdf').toString('base64');
    const payload = {
      to: address,
      from: 'estatements@bank',
      subject: 'Your statement',
      messageId: '<locked-retry@bank>',
      attachments: [
        { filename: 'statement.pdf', contentType: 'application/pdf', contentBase64: b64 },
      ],
    };

    await handleInboundEmail(env, payload);
    await handleInboundEmail(env, payload);

    expect(
      await ExpenseIngestionModel.countDocuments({ messageId: '<locked-retry@bank>' }),
    ).toBe(1);
  });

  it('swallows an empty/promo forwarded email without throwing', async () => {
    const { address } = await seedInbox();
    mocked.mockResolvedValue({ transactions: [] });
    await expect(
      handleInboundEmail(env, {
        to: address,
        from: 'promo@shop',
        subject: 'Sale!',
        text: 'Big sale today',
        messageId: '<promo@shop>',
      }),
    ).resolves.toBeUndefined();
    expect(await ExpenseIngestionModel.countDocuments()).toBe(0);
  });
});
