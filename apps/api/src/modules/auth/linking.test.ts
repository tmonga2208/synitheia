import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserModel } from '../../db/models.js';
import type { Env } from '../../config/env.js';
import { linkSocial, loginWithPassword, loginWithSocial, setPassword, signup } from './service.js';

/**
 * Google's check stands in: the "token" is the payload Google would have verified, so a
 * test can say exactly what Google asserts.
 */
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    async verifyIdToken({ idToken }: { idToken: string }) {
      const payload = JSON.parse(idToken) as Record<string, unknown>;
      return { getPayload: () => payload };
    }
  },
}));

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
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});

const env = { GOOGLE_CLIENT_IDS: ['test-client'] } as unknown as Env;
const EMAIL = 'reader@example.com';

const google = (sub: string, email = EMAIL, verified = true) =>
  JSON.stringify({ sub, email, email_verified: verified, name: 'Reader' });

async function googleAccount() {
  const { user } = await loginWithSocial(env, {
    provider: 'google',
    idToken: google('g-1'),
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  });
  return user;
}

describe('one account, several ways in', () => {
  it('lets an account made with Google add a password and then sign in with it', async () => {
    const user = await googleAccount();

    await setPassword(user._id.toString(), { newPassword: 'a-new-password-1' });

    const signedIn = await loginWithPassword(EMAIL, 'a-new-password-1');
    expect(String(signedIn._id)).toBe(String(user._id));
    expect(signedIn.authProviders).toEqual(['google', 'password']);
  });

  it('asks for the current password before changing one that exists', async () => {
    const user = await signup({
      email: EMAIL,
      password: 'first-password-1',
      name: 'R',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });

    await expect(
      setPassword(user._id.toString(), { newPassword: 'second-password-2' }),
    ).rejects.toThrow(/current password/i);
    await setPassword(user._id.toString(), {
      newPassword: 'second-password-2',
      currentPassword: 'first-password-1',
    });

    await expect(loginWithPassword(EMAIL, 'second-password-2')).resolves.toBeTruthy();
  });

  it('connects Google to an account made with email, so both sign in to it', async () => {
    const user = await signup({
      email: EMAIL,
      password: 'first-password-1',
      name: 'R',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });

    const linked = await linkSocial(env, user._id.toString(), {
      provider: 'google',
      idToken: google('g-9'),
    });
    expect(linked.authProviders).toEqual(['password', 'google']);

    const viaGoogle = await loginWithSocial(env, {
      provider: 'google',
      idToken: google('g-9'),
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });
    expect(String(viaGoogle.user._id)).toBe(String(user._id));
  });

  it('will not take a Google login that already belongs to another account', async () => {
    await googleAccount();
    const other = await signup({
      email: 'other@example.com',
      password: 'first-password-1',
      name: 'O',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });

    await expect(
      linkSocial(env, other._id.toString(), { provider: 'google', idToken: google('g-1') }),
    ).rejects.toThrow(/another Synítheia account/);
  });

  it('joins on email only when Google says the email is verified', async () => {
    await signup({
      email: EMAIL,
      password: 'first-password-1',
      name: 'R',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });

    await expect(
      loginWithSocial(env, {
        provider: 'google',
        idToken: google('g-x', EMAIL, false),
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      }),
    ).rejects.toThrow(/verified/);
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it('points an email sign-in on a Google-only account to Google', async () => {
    await googleAccount();

    await expect(loginWithPassword(EMAIL, 'whatever-password')).rejects.toThrow(
      /Continue with Google/,
    );
  });

  it('points an email sign-up on a Google-only account to Google', async () => {
    await googleAccount();

    await expect(
      signup({
        email: EMAIL,
        password: 'first-password-1',
        name: 'R',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      }),
    ).rejects.toThrow(/Continue with Google/);
  });
});
