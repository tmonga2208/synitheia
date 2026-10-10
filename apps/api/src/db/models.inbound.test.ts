import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UserModel } from './models.js';

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

const baseUser = { name: 'A', timezone: 'Asia/Kolkata', currency: 'INR' };

describe('inboundToken index', () => {
  it('allows many users with no token (null)', async () => {
    await UserModel.create({ ...baseUser, email: 'a@x.com' });
    await UserModel.create({ ...baseUser, email: 'b@x.com' });
    expect(await UserModel.countDocuments()).toBe(2);
  });

  it('rejects two users sharing the same token', async () => {
    await UserModel.create({ ...baseUser, email: 'a@x.com', inboundToken: 'dup' });
    await expect(
      UserModel.create({ ...baseUser, email: 'b@x.com', inboundToken: 'dup' }),
    ).rejects.toThrow();
  });
});
