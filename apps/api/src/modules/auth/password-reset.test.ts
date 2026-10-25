import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PasswordResetModel, RefreshTokenModel, UserModel } from '../../db/models.js';
import type { Mail } from '../../mail/resend.js';
import { confirmPasswordReset, requestPasswordReset } from './password-reset.js';
import { loginWithPassword, signup } from './service.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([UserModel.syncIndexes(), PasswordResetModel.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});

const OLD = 'old-password-123';
const NEW = 'new-password-456';

async function account(email = 'reader@example.com') {
  return signup({ email, password: OLD, name: 'Reader', timezone: 'Asia/Kolkata', currency: 'INR' });
}

/** A mailbox that keeps what it was sent. */
function mailbox() {
  const sent: Mail[] = [];
  const send = async (mail: Mail) => {
    sent.push(mail);
  };
  const lastCode = () => /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? '')?.[1];
  return { sent, send, lastCode };
}

describe('asking for a reset', () => {
  it('sends nothing for an address with no account, and says nothing different', async () => {
    const box = mailbox();

    await expect(requestPasswordReset(box.send, 'nobody@example.com')).resolves.toBeUndefined();

    expect(box.sent).toEqual([]);
    expect(await PasswordResetModel.countDocuments()).toBe(0);
  });

  it('sends a six-digit code to the account’s address', async () => {
    await account();
    const box = mailbox();

    await requestPasswordReset(box.send, '  Reader@Example.com ');

    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]!.to).toBe('reader@example.com');
    expect(box.lastCode()).toMatch(/^\d{6}$/);
    expect(box.sent[0]!.subject).toContain(box.lastCode()!);
  });

  it('tells a Google account there is no password to reset', async () => {
    await UserModel.create({
      email: 'google@example.com',
      name: 'G',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      authProviders: ['google'],
      googleSub: 'g-123',
    });
    const box = mailbox();

    await requestPasswordReset(box.send, 'google@example.com');

    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]!.text).toContain('signs in with Google');
    expect(await PasswordResetModel.countDocuments()).toBe(0);
  });
});

describe('using the code', () => {
  it('sets the new password, and the old one stops working', async () => {
    await account();
    const box = mailbox();
    await requestPasswordReset(box.send, 'reader@example.com');

    const user = await confirmPasswordReset('reader@example.com', box.lastCode()!, NEW);

    expect(user.email).toBe('reader@example.com');
    await expect(loginWithPassword('reader@example.com', NEW)).resolves.toBeTruthy();
    await expect(loginWithPassword('reader@example.com', OLD)).rejects.toThrow();
  });

  it('works once', async () => {
    await account();
    const box = mailbox();
    await requestPasswordReset(box.send, 'reader@example.com');
    const code = box.lastCode()!;

    await confirmPasswordReset('reader@example.com', code, NEW);

    await expect(confirmPasswordReset('reader@example.com', code, 'another-pass-789')).rejects.toThrow(
      /expired|Ask for a new one/,
    );
  });

  it('locks after five wrong codes, even against the right one', async () => {
    await account();
    const box = mailbox();
    await requestPasswordReset(box.send, 'reader@example.com');
    const code = box.lastCode()!;
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i += 1) {
      await expect(confirmPasswordReset('reader@example.com', wrong, NEW)).rejects.toThrow();
    }

    await expect(confirmPasswordReset('reader@example.com', code, NEW)).rejects.toThrow(/Too many/);
    await expect(loginWithPassword('reader@example.com', OLD)).resolves.toBeTruthy();
  });

  it('says how many tries are left after a wrong code', async () => {
    await account();
    const box = mailbox();
    await requestPasswordReset(box.send, 'reader@example.com');
    const wrong = box.lastCode() === '000000' ? '111111' : '000000';

    await expect(confirmPasswordReset('reader@example.com', wrong, NEW)).rejects.toThrow(
      'That code isn’t right. 4 tries left.',
    );
  });

  it('refuses a code past its fifteen minutes', async () => {
    await account();
    const box = mailbox();
    await requestPasswordReset(box.send, 'reader@example.com');
    await PasswordResetModel.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    await expect(confirmPasswordReset('reader@example.com', box.lastCode()!, NEW)).rejects.toThrow(
      /expired/,
    );
  });

  it('accepts only the newest code when asked twice', async () => {
    await account();
    const box = mailbox();
    await requestPasswordReset(box.send, 'reader@example.com');
    const first = box.lastCode()!;
    await requestPasswordReset(box.send, 'reader@example.com');
    const second = box.lastCode()!;

    if (first !== second) {
      await expect(confirmPasswordReset('reader@example.com', first, NEW)).rejects.toThrow();
    }
    await expect(confirmPasswordReset('reader@example.com', second, NEW)).resolves.toBeTruthy();
  });

  it('signs out every other session, since someone may have had the old password', async () => {
    const user = await account();
    await RefreshTokenModel.collection.insertMany([
      { userId: user._id, tokenHash: new Types.ObjectId().toString(), family: 'a', revokedAt: null },
      { userId: user._id, tokenHash: new Types.ObjectId().toString(), family: 'b', revokedAt: null },
    ]);
    const box = mailbox();
    await requestPasswordReset(box.send, 'reader@example.com');

    await confirmPasswordReset('reader@example.com', box.lastCode()!, NEW);

    // Revoked, as everywhere else: a revoked refresh token can never be used again.
    expect(await RefreshTokenModel.countDocuments({ userId: user._id, revokedAt: null })).toBe(0);
  });
});
