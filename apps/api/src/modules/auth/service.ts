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

const PROVIDER_NAME: Record<AuthProvider, string> = {
  password: 'email',
  google: 'Google',
  apple: 'Apple',
};

/**
 * "Continue with Google" for an account that has no password. Said instead of "incorrect
 * password" or "already exists", which left someone who signed up with Google nowhere to go.
 */
function useYourProvider(providers: AuthProvider[]): string {
  const social = providers.filter((p) => p !== 'password').map((p) => PROVIDER_NAME[p]);
  const which = social.length > 0 ? social.join(' or ') : 'the way you signed up';
  return `This email signs in with ${which}. Continue with ${which}, then add a password in You → Sign-in methods.`;
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
  const existing = await UserModel.findOne({ email }).select('+passwordHash').lean();
  if (existing) {
    // Deliberately explicit. Email enumeration is a real but minor leak; a vague
    // "signup failed" here produces support tickets and teaches users nothing.
    if (!existing.passwordHash) {
      throw AppError.conflict(useYourProvider(existing.authProviders as AuthProvider[]));
    }
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

  if (user && !user.passwordHash) {
    throw AppError.unauthorized(useYourProvider(user.authProviders as AuthProvider[]));
  }
  if (!user || !ok) {
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
  /** Whether the provider has confirmed the person owns `email`. Joining on it needs this. */
  emailVerified: boolean;
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
      // Apple sends this as a boolean or as the string "true".
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
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
      emailVerified: payload.email_verified === true,
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
  // An email the provider has not confirmed is only a string someone typed into their
  // Google account. Joining or creating on it would hand that person whoever owns it.
  if (identity.email && !identity.emailVerified) {
    throw AppError.unauthorized(
      `${PROVIDER_NAME[identity.provider]} hasn't verified this email yet. Verify it there, or sign up with email.`,
    );
  }

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

/**
 * Connect Google or Apple to the account that is signed in, so it opens with either.
 *
 * The person is already signed in, and now proves they own the Google or Apple login too,
 * so the two emails need not match. A login already attached to a different account is
 * refused rather than moved: moving it would sign someone out of their other account.
 */
export async function linkSocial(
  env: Env,
  userId: string,
  input: { provider: 'apple' | 'google'; idToken: string },
): Promise<UserWithId> {
  const identity =
    input.provider === 'apple'
      ? await verifyAppleToken(env, input.idToken)
      : await verifyGoogleToken(env, input.idToken);
  const subField = identity.provider === 'apple' ? 'appleSub' : 'googleSub';

  const owner = await UserModel.findOne({ [subField]: identity.sub }, { _id: 1 }).lean();
  if (owner && String(owner._id) !== userId) {
    throw AppError.conflict(
      `This ${PROVIDER_NAME[identity.provider]} login already signs in to another Synítheia account.`,
    );
  }

  const user = await UserModel.findById(userId);
  if (!user) throw AppError.notFound('User');
  user.set(subField, identity.sub);
  if (!user.authProviders.includes(identity.provider)) user.authProviders.push(identity.provider);
  await user.save();
  return user as UserWithId;
}

/**
 * Add a password to the signed-in account, or change it. Adding needs nothing more than
 * being signed in; changing one that exists needs the current one, so a phone left
 * unlocked cannot be used to lock its owner out.
 */
export async function setPassword(
  userId: string,
  input: { newPassword: string; currentPassword?: string },
): Promise<UserWithId> {
  const user = await UserModel.findById(userId).select('+passwordHash');
  if (!user) throw AppError.notFound('User');

  if (user.passwordHash) {
    const ok = input.currentPassword
      ? await verifyPassword(user.passwordHash, input.currentPassword)
      : false;
    if (!ok) throw AppError.unauthorized('Your current password is incorrect');
  }

  user.passwordHash = await hashPassword(input.newPassword);
  if (!user.authProviders.includes('password')) user.authProviders.push('password');
  await user.save();
  return user as UserWithId;
}
