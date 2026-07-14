import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { UserModel } from '../db/models.js';
import type { Env } from '../config/env.js';

export interface AuthedUser {
  id: string;
  timezone: string;
  currency: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only on routes registered behind `requireAuth`. */
    user: AuthedUser;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authGuard = fp<{ env: Env }>(async (app, { env }) => {
  app.decorate('requireAuth', async (req: FastifyRequest, _reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthorized('Missing bearer token');
    }

    const claims = await verifyAccessToken(env, header.slice(7));

    /**
     * The timezone is re-read from the database rather than trusted from the token.
     *
     * A JWT is a snapshot: a user who flies to Tokyo and updates their timezone would
     * otherwise keep writing events against their old zone until the token expires,
     * silently filing today's expenses under yesterday. Every localDate in the system
     * depends on this being current, so it is worth the lookup.
     */
    const user = await UserModel.findById(claims.sub, {
      timezone: 1,
      currency: 1,
    }).lean();

    if (!user) throw AppError.unauthorized('Account no longer exists');

    req.user = {
      id: claims.sub,
      timezone: user.timezone,
      currency: user.currency,
    };
  });
});
