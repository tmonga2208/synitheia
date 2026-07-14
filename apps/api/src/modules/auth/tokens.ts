import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { Types } from 'mongoose';
import { AppError } from '../../core/errors.js';
import { RefreshTokenModel } from '../../db/models.js';
import type { Env } from '../../config/env.js';

export interface AccessTokenClaims {
  sub: string;
  tz: string;
}

const ISSUER = 'synitheia';
const AUDIENCE = 'synitheia-mobile';

function secretKey(env: Env): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

/**
 * Refresh tokens are stored as SHA-256 hashes, never in the clear.
 *
 * A database dump — a leaked backup, a compromised read replica — must not hand the
 * attacker a working session for every user in the table. This is the same reasoning
 * as password hashing; a refresh token is a long-lived credential and deserves the
 * same treatment. (SHA-256, not argon2: these are 256-bit random values, not
 * low-entropy human passwords, so there is nothing to brute-force and no need to
 * make verification deliberately slow.)
 */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function signAccessToken(
  env: Env,
  userId: string,
  timezone: string,
): Promise<string> {
  return new SignJWT({ tz: timezone })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(secretKey(env));
}

export async function verifyAccessToken(
  env: Env,
  token: string,
): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(env), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload.sub) throw new Error('missing sub');
    return { sub: payload.sub, tz: String(payload.tz ?? 'UTC') };
  } catch {
    // Never echo the underlying jose error — "signature verification failed" vs
    // "token expired" is a free oracle for an attacker probing the endpoint.
    throw AppError.unauthorized('Invalid or expired token');
  }
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function issueTokens(
  env: Env,
  userId: string,
  timezone: string,
  opts: { family?: string; userAgent?: string | null } = {},
): Promise<IssuedTokens> {
  const raw = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86_400_000);

  await RefreshTokenModel.create({
    userId: new Types.ObjectId(userId),
    tokenHash: hashToken(raw),
    family: opts.family ?? randomUUID(),
    expiresAt,
    userAgent: opts.userAgent ?? null,
  });

  return {
    accessToken: await signAccessToken(env, userId, timezone),
    refreshToken: raw,
    expiresIn: env.JWT_REFRESH_TTL_DAYS * 86_400,
  };
}

/**
 * Rotate a refresh token, with reuse detection.
 *
 * Every refresh consumes the presented token and issues a fresh one in the same
 * `family`. If a token that has ALREADY been consumed is presented again, exactly one
 * of two things is true: the token was stolen and the thief is now using it, or the
 * token was stolen and the legitimate user is. We cannot tell which — so we revoke
 * the entire family, forcing a re-login and cutting the attacker off. Silently issuing
 * new tokens instead would let a stolen refresh token grant indefinite access, which
 * is the single most common way "we have refresh tokens" turns out to mean nothing.
 */
export async function rotateRefreshToken(
  env: Env,
  presented: string,
  timezone: string,
  userAgent?: string | null,
): Promise<IssuedTokens & { userId: string }> {
  const tokenHash = hashToken(presented);
  const existing = await RefreshTokenModel.findOne({ tokenHash });

  if (!existing) throw AppError.unauthorized('Invalid refresh token');

  if (existing.revokedAt) {
    await RefreshTokenModel.updateMany(
      { family: existing.family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    throw AppError.unauthorized('Refresh token reuse detected — all sessions revoked');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized('Refresh token expired');
  }

  const userId = existing.userId.toString();
  const next = await issueTokens(env, userId, timezone, {
    family: existing.family,
    userAgent,
  });

  existing.revokedAt = new Date();
  existing.replacedBy = hashToken(next.refreshToken);
  await existing.save();

  return { ...next, userId };
}

export async function revokeToken(presented: string): Promise<void> {
  await RefreshTokenModel.updateOne(
    { tokenHash: hashToken(presented), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await RefreshTokenModel.updateMany(
    { userId: new Types.ObjectId(userId), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}
