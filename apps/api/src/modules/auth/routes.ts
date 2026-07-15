import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  completeOnboardingSchema,
  currencySchema,
  timeZoneSchema,
  updateTargetsSchema,
} from '@synitheia/shared';
import { Types } from 'mongoose';
import { HabitModel, UserModel, UserPreferenceModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import * as service from './service.js';
import { issueTokens, revokeAllForUser, revokeToken, rotateRefreshToken } from './tokens.js';
import type { Env } from '../../config/env.js';

/**
 * Password policy: length over composition rules.
 *
 * Forcing a symbol and a digit reliably produces "Password1!" and nothing else.
 * Length is what actually resists an offline attack against the argon2 hashes.
 */
const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200);

/**
 * The user shape the client is allowed to see.
 *
 * An explicit allowlist, not a redaction of the document — `passwordHash`, `appleSub`,
 * and `googleSub` cannot leak through a field someone forgets to strip, because they
 * are never copied in the first place.
 */
interface PublicUserSource {
  _id: unknown;
  email: string;
  name: string;
  avatarUrl?: string | null;
  timezone: string;
  currency: string;
  xp: number;
  authProviders: string[];
  onboardedAt?: Date | null;
}

function publicUser(user: PublicUserSource) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    timezone: user.timezone,
    currency: user.currency,
    xp: user.xp,
    authProviders: user.authProviders,
    onboardedAt: user.onboardedAt ?? null,
  };
}

export async function registerAuthRoutes(app: FastifyInstance, env: Env): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    '/auth/signup',
    {
      // Signup and login are the endpoints an attacker hammers. A tighter limit here
      // than the global one is the cheapest possible credential-stuffing defence.
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: {
        body: z.object({
          email: z.string().email(),
          password: passwordSchema,
          name: z.string().min(1).max(80),
          timezone: timeZoneSchema,
          currency: currencySchema.default('INR'),
        }),
      },
    },
    async (req, reply) => {
      const user = await service.signup(req.body);
      const tokens = await issueTokens(env, user._id.toString(), user.timezone, {
        userAgent: req.headers['user-agent'] ?? null,
      });

      return reply.status(201).send({ user: publicUser(user), ...tokens });
    },
  );

  api.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: {
        body: z.object({
          email: z.string().email(),
          password: z.string().min(1),
        }),
      },
    },
    async (req) => {
      const user = await service.loginWithPassword(req.body.email, req.body.password);
      const tokens = await issueTokens(env, user._id.toString(), user.timezone, {
        userAgent: req.headers['user-agent'] ?? null,
      });

      return { user: publicUser(user), ...tokens };
    },
  );

  api.post(
    '/auth/social',
    {
      config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
      schema: {
        body: z.object({
          provider: z.enum(['apple', 'google']),
          idToken: z.string().min(1),
          /** Apple returns the name only on first authorization, so the client forwards it. */
          name: z.string().max(80).nullish(),
          timezone: timeZoneSchema,
          currency: currencySchema.default('INR'),
        }),
      },
    },
    async (req, reply) => {
      const { user, isNew } = await service.loginWithSocial(env, req.body);
      const tokens = await issueTokens(env, user._id.toString(), user.timezone, {
        userAgent: req.headers['user-agent'] ?? null,
      });

      return reply
        .status(isNew ? 201 : 200)
        .send({ user: publicUser(user), isNew, ...tokens });
    },
  );

  api.post(
    '/auth/refresh',
    {
      schema: { body: z.object({ refreshToken: z.string().min(1) }) },
    },
    async (req) => {
      // Look up the user's *current* timezone rather than reusing the old token's —
      // see the note in auth-guard.ts. A stale timezone silently misfiles every event.
      const rotated = await rotateRefreshToken(
        env,
        req.body.refreshToken,
        'UTC',
        req.headers['user-agent'] ?? null,
      );

      const user = await UserModel.findById(rotated.userId, { timezone: 1 }).lean();
      if (!user) throw AppError.unauthorized('Account no longer exists');

      // Re-sign the access token with the real timezone.
      const tokens = await issueTokens(env, rotated.userId, user.timezone, {
        userAgent: req.headers['user-agent'] ?? null,
      });

      return tokens;
    },
  );

  api.post(
    '/auth/logout',
    { schema: { body: z.object({ refreshToken: z.string().min(1) }) } },
    async (req, reply) => {
      await revokeToken(req.body.refreshToken);
      return reply.status(204).send();
    },
  );

  api.post(
    '/auth/logout-all',
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      await revokeAllForUser(req.user.id);
      return reply.status(204).send();
    },
  );

  // ─── Current user ─────────────────────────────────────────────────────────

  api.get('/me', { onRequest: [app.requireAuth] }, async (req) => {
    const user = await UserModel.findById(req.user.id).lean();
    if (!user) throw AppError.notFound('User');

    const preferences = await UserPreferenceModel.findOne({
      userId: user._id,
    }).lean();

    return { user: publicUser(user), preferences };
  });

  // ─── Targets ──────────────────────────────────────────────────────────────
  //
  // Read and write the water/calorie/budget numbers on their own, outside the onboarding
  // wizard. The screen that used these was pointed at /setup, which the onboarded-user guard
  // bounces straight to Today — so the numbers were uneditable after day one.

  api.get('/me/targets', { onRequest: [app.requireAuth] }, async (req) => {
    const user = await UserModel.findById(req.user.id).lean();
    if (!user) throw AppError.notFound('User');

    const prefs = await UserPreferenceModel.findOne({ userId: user._id }).lean();

    return {
      trackedDomains: prefs?.trackedDomains ?? ['habits', 'expenses', 'nutrition', 'water'],
      waterTargetMl: prefs?.waterTargetMl ?? 2500,
      calorieTarget: prefs?.calorieTarget ?? 2000,
      monthlyBudgetMinor: prefs?.monthlyBudgetMinor ?? null,
      currency: user.currency ?? 'INR',
    };
  });

  api.patch(
    '/me/targets',
    { onRequest: [app.requireAuth], schema: { body: updateTargetsSchema } },
    async (req) => {
      const userId = new Types.ObjectId(req.user.id);

      // Only the fields the client sent. Absent must not blank a target the user still has —
      // a screen that hides the water field for a non-water user must not zero their water.
      const set: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (value !== undefined) set[key] = value;
      }

      const preferences = await UserPreferenceModel.findOneAndUpdate(
        { userId },
        { $set: set },
        { new: true, upsert: true },
      ).lean();

      return { preferences };
    },
  );

  api.patch(
    '/me',
    {
      onRequest: [app.requireAuth],
      schema: {
        body: z.object({
          name: z.string().min(1).max(80).optional(),
          timezone: timeZoneSchema.optional(),
          currency: currencySchema.optional(),
          avatarUrl: z.string().url().nullish(),
        }),
      },
    },
    async (req) => {
      const user = await UserModel.findByIdAndUpdate(
        req.user.id,
        { $set: req.body },
        { new: true },
      ).lean();

      if (!user) throw AppError.notFound('User');
      return { user: publicUser(user) };
    },
  );

  /**
   * Finish onboarding, in one request.
   *
   * Habits, preferences, and the onboarded flag land together. Splitting this across
   * several calls would let setup fail halfway and strand a user with two habits, no
   * targets, and a Today screen that thinks they never finished — with no route back,
   * because onboarding does not run twice.
   */
  api.post(
    '/me/onboarded',
    {
      onRequest: [app.requireAuth],
      schema: { body: completeOnboardingSchema },
    },
    async (req) => {
      const userId = new Types.ObjectId(req.user.id);
      const { habits, currency, reminderTime, trackedDomains, ...targets } = req.body;

      if (habits.length > 0) {
        await HabitModel.insertMany(
          habits.map((h) => ({
            userId,
            name: h.name,
            icon: h.icon,
            color: h.color,
            category: null,
            frequency: 'daily',
            targetCount: 1,
            unit: null,
            reminderTime: reminderTime ?? null,
            currentStreak: 0,
            longestStreak: 0,
            archivedAt: null,
          })),
        );
      }

      const preferences = await UserPreferenceModel.findOneAndUpdate(
        { userId },
        {
          $set: {
            trackedDomains,
            ...targets,
            ...(reminderTime ? { reminderDefaultTime: reminderTime } : {}),
            notificationsEnabled: Boolean(reminderTime),
          },
        },
        { new: true, upsert: true },
      ).lean();

      // Last, so a failure above leaves the user still onboarding rather than half set up.
      await UserModel.findByIdAndUpdate(userId, {
        $set: { onboardedAt: new Date(), ...(currency ? { currency } : {}) },
      });

      return { preferences };
    },
  );
}
