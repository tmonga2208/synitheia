import argon2 from 'argon2';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { OAuth2Client } from 'google-auth-library';
import type { Types} from 'mongoose';
import { type ClientSession } from 'mongoose';
import {
  DEFAULT_PREFERENCES,
  SYSTEM_CATEGORIES,
  isValidTimeZone,
  type AuthProvider,
} from '@synitheia/shared';
import { AppError } from '../../core/errors.js';
import {
  ExpenseCategoryModel,
  UserModel,
  UserPreferenceModel,
  type UserDoc,
} from '../../db/models.js';
import type { Env } from '../../config/env.js';

export type UserWithId = UserDoc & { _id: Types.ObjectId };

/**
 * Argon2id: memory-hard, so a GPU farm gains far less advantage than it would
 * against bcrypt. These parameters target ~100ms on commodity hardware — slow enough
 * to make offline cracking expensive, fast enough that login does not feel broken.
 */
const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP's current floor
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Seed the things a new account cannot function without. */
async function provisionUser(userId: Types.ObjectId, session?: ClientSession) {
  await UserPreferenceModel.create(
    [{ userId, ...DEFAULT_PREFERENCES }],
    session ? { session } : {},
  );

  await ExpenseCategoryModel.insertMany(
    SYSTEM_CATEGORIES.map((c) => ({ userId, ...c, isSystem: true })),
    session ? { session } : {},
  );
}

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  timezone: string;
  currency: string;
}

export async function signup(input: SignupInput): Promise<UserWithId> {
  if (!isValidTimeZone(input.timezone)) {
    throw AppError.badRequest(`Invalid timezone: ${input.timezone}`);
  }

  const email = input.email.toLowerCase().trim();
  const existing = await UserModel.findOne({ email }).lean();
  if (existing) {
    // Deliberately explicit. Email enumeration is a real but minor leak; a vague
    // "signup failed" here produces support tickets and teaches users nothing.
    throw AppError.conflict('An account with this email already exists');
  }

  const user = await UserModel.create({
    email,
    name: input.name.trim(),
    timezone: input.timezone,
    currency: input.currency,
    passwordHash: await hashPassword(input.password),
    authProviders: ['password'],
  });

  await provisionUser(user._id);
  return user as UserWithId;
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<UserWithId> {
  const user = await UserModel.findOne({ email: email.toLowerCase().trim() }).select(
    '+passwordHash',
  );

  // Constant-ish work whether or not the user exists, so response timing does not
  // reveal which emails are registered.
  const hash = user?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$notarealsalt$notarealhash';
  const ok = await verifyPassword(hash, password);

  if (!user || !ok || !user.passwordHash) {
    throw AppError.unauthorized('Incorrect email or password');
  }

  return user as UserWithId;
}

// ─── Social sign-in ─────────────────────────────────────────────────────────

const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

interface SocialIdentity {
  provider: AuthProvider;
  sub: string;
  email: string | null;
  name: string | null;
}

/**
 * Verify an Apple identity token against Apple's published keys.
 *
 * The client sends the token it got from Sign in with Apple; we never trust its
 * claims about who the user is. Verifying the signature, issuer, and audience
 * server-side is the entire security boundary here — a client-side check is
 * decorative, since a malicious client simply would not perform it.
 */
async function verifyAppleToken(env: Env, idToken: string): Promise<SocialIdentity> {
  if (!env.APPLE_CLIENT_ID) {
    throw AppError.badRequest('Apple sign-in is not configured on this server');
  }

  try {
    const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: env.APPLE_CLIENT_ID,
    });

    if (!payload.sub) throw new Error('missing sub');

    return {
      provider: 'apple',
      sub: payload.sub,
      // Apple only returns the email on the FIRST authorization, and only if the
      // user agreed to share it. It may legitimately be absent forever after.
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      name: null, // Apple never puts the name in the token; the client passes it separately.
    };
  } catch {
    throw AppError.unauthorized('Invalid Apple identity token');
  }
}

async function verifyGoogleToken(env: Env, idToken: string): Promise<SocialIdentity> {
  if (env.GOOGLE_CLIENT_IDS.length === 0) {
    throw AppError.badRequest('Google sign-in is not configured on this server');
  }

  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_IDS,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new Error('missing sub');

    return {
      provider: 'google',
      sub: payload.sub,
      email: payload.email?.toLowerCase() ?? null,
      name: payload.name ?? null,
    };
  } catch {
    throw AppError.unauthorized('Invalid Google identity token');
  }
}

export interface SocialLoginInput {
  provider: 'apple' | 'google';
  idToken: string;
  /** Apple only supplies the name on first authorization, so the client forwards it. */
  name?: string | null;
  timezone: string;
  currency: string;
}

export async function loginWithSocial(
  env: Env,
  input: SocialLoginInput,
): Promise<{ user: UserWithId; isNew: boolean }> {
  const identity =
    input.provider === 'apple'
      ? await verifyAppleToken(env, input.idToken)
      : await verifyGoogleToken(env, input.idToken);

  const subField = identity.provider === 'apple' ? 'appleSub' : 'googleSub';

  const bySub = await UserModel.findOne({ [subField]: identity.sub });
  if (bySub) return { user: bySub as UserWithId, isNew: false };

  /**
   * Link to an existing account when the verified email matches.
   *
   * Safe *only* because the email came from a token we cryptographically verified
   * against Apple's or Google's keys — it is an assertion by the identity provider,
   * not a string the client typed. Linking on a client-supplied email would be an
   * account takeover primitive.
   */
  if (identity.email) {
    const byEmail = await UserModel.findOne({ email: identity.email });
    if (byEmail) {
      byEmail.set(subField, identity.sub);
      if (!byEmail.authProviders.includes(identity.provider)) {
        byEmail.authProviders.push(identity.provider);
      }
      await byEmail.save();
      return { user: byEmail as UserWithId, isNew: false };
    }
  }

  if (!identity.email) {
    throw AppError.badRequest(
      'This provider did not share an email address. Please sign up with email instead.',
    );
  }

  if (!isValidTimeZone(input.timezone)) {
    throw AppError.badRequest(`Invalid timezone: ${input.timezone}`);
  }

  const user = await UserModel.create({
    email: identity.email,
    name: input.name?.trim() || identity.name || identity.email.split('@')[0],
    timezone: input.timezone,
    currency: input.currency,
    authProviders: [identity.provider],
    [subField]: identity.sub,
  });

  await provisionUser(user._id);
  return { user: user as UserWithId, isNew: true };
}
