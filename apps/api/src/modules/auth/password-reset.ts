import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { PasswordResetModel, UserModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import type { SendMail } from '../../mail/resend.js';
import { hashPassword, type UserWithId } from './service.js';
import { revokeAllForUser } from './tokens.js';

/**
 * A way back in for someone who forgot their password: a six-digit code by email.
 *
 * Before this, a forgotten password lost the account and everything in it. A code rather
 * than a link, because the app has nowhere to open a link to; it is typed into the app.
 * Fifteen minutes, five tries, one use, and the newest code replaces any older one. The
 * code is stored only as a hash. Setting the new password ends every other session, since
 * whoever knew the old one may still be signed in.
 */

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashCode(userId: string, code: string): string {
  return createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

function providerName(providers: readonly string[]): string {
  if (providers.includes('google')) return 'Google';
  if (providers.includes('apple')) return 'Apple';
  return 'Google or Apple';
}

/**
 * Sends the code, or for an account without a password, says how it signs in. An address
 * with no account gets nothing, and the caller answers the same either way.
 */
export async function requestPasswordReset(send: SendMail, emailInput: string): Promise<void> {
  const email = emailInput.toLowerCase().trim();
  const user = await UserModel.findOne({ email }).select('+passwordHash').lean();
  if (!user) return;

  if (!user.passwordHash) {
    const provider = providerName(user.authProviders);
    await send({
      to: email,
      subject: 'Signing in to Synítheia',
      text: [
        'Someone asked to reset the password for this Synítheia account.',
        `This account signs in with ${provider}, so there is no password to reset. Open Synítheia and choose "Continue with ${provider}".`,
        'If this was not you, you can ignore this email.',
      ].join('\n\n'),
    });
    return;
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await PasswordResetModel.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        codeHash: hashCode(String(user._id), code),
        attempts: 0,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    },
    { upsert: true },
  );

  await send({
    to: email,
    subject: `${code} is your Synítheia reset code`,
    text: [
      `Your code to reset your Synítheia password is ${code}.`,
      'It works once, for 15 minutes. Type it into the app with your new password.',
      'If you did not ask for this, ignore this email; your password stays as it is.',
    ].join('\n\n'),
  });
}

/** Checks the code and sets the new password. Returns the user, to be signed in. */
export async function confirmPasswordReset(
  emailInput: string,
  code: string,
  password: string,
): Promise<UserWithId> {
  const email = emailInput.toLowerCase().trim();
  const user = (await UserModel.findOne({ email })) as UserWithId | null;
  const reset = user ? await PasswordResetModel.findOne({ userId: user._id }) : null;

  if (!user || !reset || reset.expiresAt.getTime() <= Date.now()) {
    throw AppError.badRequest('That code has expired or was never sent. Ask for a new one.');
  }
  if (reset.attempts >= MAX_ATTEMPTS) {
    throw AppError.badRequest('Too many wrong codes. Ask for a new one.');
  }

  const expected = Buffer.from(reset.codeHash, 'hex');
  const given = Buffer.from(hashCode(String(user._id), code.trim()), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    const attempts = reset.attempts + 1;
    await PasswordResetModel.updateOne({ _id: reset._id }, { $set: { attempts } });
    const left = MAX_ATTEMPTS - attempts;
    throw AppError.badRequest(
      left > 0
        ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
        : 'Too many wrong codes. Ask for a new one.',
    );
  }

  await UserModel.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(password) } });
  await PasswordResetModel.deleteOne({ _id: reset._id });
  await revokeAllForUser(String(user._id));

  return user;
}
