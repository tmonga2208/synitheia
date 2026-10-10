import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { UserModel, ExpenseIngestionModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import type { Env } from '../../config/env.js';

/** Case-insensitive (hex), so an address surviving a provider's lower-casing still resolves. */
export function generateInboundToken(): string {
  return randomBytes(16).toString('hex');
}

export function inboundAddress(token: string, domain: string): string {
  return `inbox-${token}@${domain}`;
}

/** Parse the token out of "inbox-<token>@<domain>". Null if the shape or domain is wrong. */
export function tokenFromAddress(to: string, domain: string): string | null {
  const at = to.trim().toLowerCase();
  const suffix = `@${domain.toLowerCase()}`;
  if (!at.endsWith(suffix)) return null;
  const local = at.slice(0, -suffix.length);
  if (!local.startsWith('inbox-')) return null;
  const token = local.slice('inbox-'.length);
  return /^[a-f0-9]{32}$/.test(token) ? token : null;
}

async function lastReceivedAt(userId: Types.ObjectId): Promise<Date | null> {
  const last = await ExpenseIngestionModel.findOne({ userId, channel: 'email' })
    .sort({ createdAt: -1 })
    .select('createdAt')
    .lean();
  return last?.createdAt ?? null;
}

export async function getOrCreateInbox(env: Env, userId: string) {
  if (!env.INBOUND_DOMAIN) {
    throw AppError.badRequest('The statement inbox is not enabled on this server.');
  }
  const _id = new Types.ObjectId(userId);
  const user = await UserModel.findById(_id).select('+inboundToken inboundEnabledAt').lean();
  if (!user) throw AppError.notFound('User');

  let token = user.inboundToken;
  let enabledAt = user.inboundEnabledAt;
  if (!token) {
    token = generateInboundToken();
    enabledAt = new Date();
    await UserModel.updateOne(
      { _id },
      { $set: { inboundToken: token, inboundEnabledAt: enabledAt } },
    );
  }

  return {
    address: inboundAddress(token, env.INBOUND_DOMAIN),
    enabledAt,
    lastReceivedAt: await lastReceivedAt(_id),
  };
}

export async function getInbox(env: Env, userId: string) {
  if (!env.INBOUND_DOMAIN) {
    throw AppError.badRequest('The statement inbox is not enabled on this server.');
  }
  const _id = new Types.ObjectId(userId);
  const user = await UserModel.findById(_id).select('+inboundToken inboundEnabledAt').lean();
  if (!user) throw AppError.notFound('User');
  if (!user.inboundToken) return null;

  return {
    address: inboundAddress(user.inboundToken, env.INBOUND_DOMAIN),
    enabledAt: user.inboundEnabledAt,
    lastReceivedAt: await lastReceivedAt(_id),
  };
}
