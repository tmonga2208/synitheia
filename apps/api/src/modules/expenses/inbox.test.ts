import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UserModel } from '../../db/models.js';
import {
  generateInboundToken,
  inboundAddress,
  tokenFromAddress,
  getOrCreateInbox,
} from './inbox.js';
import type { Env } from '../../config/env.js';

const env = { INBOUND_DOMAIN: 'in.example.app' } as Env;

describe('inbox helpers (pure)', () => {
  it('generates a 32-char hex token', () => {
    expect(generateInboundToken()).toMatch(/^[a-f0-9]{32}$/);
  });
  it('formats the address', () => {
    expect(inboundAddress('abc123', 'in.example.app')).toBe('inbox-abc123@in.example.app');
  });
  it('round-trips the token, case-insensitively', () => {
    const t = generateInboundToken();
    expect(tokenFromAddress(`INBOX-${t}@IN.EXAMPLE.APP`, 'in.example.app')).toBe(t);
  });
  it('rejects wrong domain, wrong prefix, junk local part', () => {
    expect(tokenFromAddress('inbox-abc@other.app', 'in.example.app')).toBeNull();
    expect(tokenFromAddress('hello-abc@in.example.app', 'in.example.app')).toBeNull();
    expect(tokenFromAddress('inbox-@in.example.app', 'in.example.app')).toBeNull();
  });
});

let mongo: MongoMemoryReplSet;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await UserModel.syncIndexes();
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
afterEach(async () => {
  await UserModel.deleteMany({});
});

describe('getOrCreateInbox', () => {
  it('creates once and returns the same address on repeat', async () => {
    const u = await UserModel.create({
      name: 'A', email: 'a@x.com', timezone: 'Asia/Kolkata', currency: 'INR',
    });
    const first = await getOrCreateInbox(env, u._id.toString());
    const second = await getOrCreateInbox(env, u._id.toString());
    expect(first.address).toMatch(/^inbox-[a-f0-9]{32}@in\.example\.app$/);
    expect(second.address).toBe(first.address);
    expect(first.enabledAt).not.toBeNull();
    expect(first.lastReceivedAt).toBeNull();
  });
});
