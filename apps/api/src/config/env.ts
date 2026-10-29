import { z } from 'zod';

/**
 * Environment is validated once, at boot, and the process refuses to start if it
 * is wrong. The alternative — reading `process.env.X` at the call site — means a
 * missing ANTHROPIC_API_KEY surfaces as a 500 at 3am on the first request that
 * happens to need it, in production, days after the bad deploy.
 *
 * Nothing in here is ever sent to the client. The mobile app receives no secrets.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    MONGO_URI: z.string().url(),

    /**
     * Access tokens are short-lived and refresh tokens rotate, so a stolen access
     * token is useful for minutes, not forever. 32 bytes minimum — a guessable JWT
     * secret makes every other security control decorative.
     */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

    /** Bundle id / client ids used to verify Apple and Google identity tokens. */
    APPLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_IDS: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])),

    /**
     * The Synítheia AI layer. Optional: the app is fully functional without it, and
     * every AI code path is gated on both a key AND the user's explicit consent.
     *
     * Provider is a deployment choice, not an architectural one — see ai/client.ts.
     * Leave AI_PROVIDER unset and whichever key is present is used; set it explicitly
     * when both are.
     */
    AI_PROVIDER: z.enum(['anthropic', 'gemini']).optional(),

    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),

    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

    /**
     * ImageKit — receipt image storage. Optional: without it, receipts are unavailable
     * and nothing else changes. Mongo stores only the file id and path; the bytes never
     * touch our database.
     */
    IMAGEKIT_URL_ENDPOINT: z.string().url().optional(),
    IMAGEKIT_PUBLIC_KEY: z.string().optional(),
    IMAGEKIT_PRIVATE_KEY: z.string().optional(),

    CORS_ORIGINS: z
      .string()
      .default('*')
      .transform((v) => (v === '*' ? '*' : v.split(',').map((s) => s.trim()))),

    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(200),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),

    /**
     * UPI Lens API — external statement parser service.
     * Parses bank statements (PDF text, CSV, XLS, XLSX) into structured transactions
     * with Indian UPI recognition, merchants, and categories.
     *
     * The Vercel deployment, not Render's: Render's free tier sleeps when idle and takes
     * about a minute to wake, longer than an upload waits, so the first statement after a
     * quiet spell always fell through to the model.
     */
    UPI_LENS_API_URL: z.string().url().default('https://upi-lens-api.vercel.app'),
    /**
     * The key upi-lens checks once its own UPI_LENS_API_KEY is set. Statements are bank
     * history; without the key the service would parse them for anyone who asked.
     */
    UPI_LENS_API_KEY: z.string().optional(),

    /**
     * Statement Inbox — inbound email ingestion. Optional: absent, the inbox endpoints
     * return 400 and the webhook no-ops. INBOUND_DOMAIN is the domain whose MX points at
     * the inbound provider (e.g. "in.synitheia.app"); the secret authenticates the
     * provider's webhook calls.
     */
    INBOUND_DOMAIN: z.string().optional(),
    INBOUND_WEBHOOK_SECRET: z.string().min(16).optional(),

    /**
     * Outgoing email through Resend, for password-reset codes. Optional: without both,
     * GET /auth/options reports no password reset and the app hides "Forgot password?".
     * MAIL_FROM must be on a domain verified in Resend, e.g. "Synítheia <hello@example.com>".
     */
    RESEND_API_KEY: z.string().optional(),
    MAIL_FROM: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // Defaults that are merely inconvenient in dev are dangerous in production.
    if (env.CORS_ORIGINS === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must be an explicit allowlist in production, not "*"',
      });
    }

    /**
     * A length check is not a strength check.
     *
     * "dev-only-secret-do-not-use-in-prod" is 34 characters and sails through `min(32)` —
     * and it signs every access token in the system. Anyone who can guess it can mint a
     * valid token for ANY account, which makes every other control in this file decorative.
     *
     * The most likely way that happens is not an attack; it is a .env copied to a server.
     * So the process refuses to start rather than come up quietly compromised.
     */
    const secret = env.JWT_SECRET.toLowerCase();
    if (['dev', 'test', 'change', 'secret', 'example', 'placeholder', 'localhost'].some((w) =>
      secret.includes(w),
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message:
          'JWT_SECRET looks like a development placeholder. Generate a real one: openssl rand -base64 48',
      });
    }
  })
  .superRefine((env, ctx) => {
    // Selecting a provider whose key is absent produces a feature that silently does
    // nothing — the worst possible failure, because it looks like a bug in the app.
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY',
      });
    }
    if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GEMINI_API_KEY'],
        message: 'AI_PROVIDER=gemini requires GEMINI_API_KEY',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Fail loudly and legibly. This is the last moment a human is watching.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Tests build isolated envs; production reads process.env exactly once. */
export function resetEnvCache(): void {
  cached = null;
}

export function isImageKitConfigured(env: Env): boolean {
  return Boolean(
    env.IMAGEKIT_URL_ENDPOINT && env.IMAGEKIT_PUBLIC_KEY && env.IMAGEKIT_PRIVATE_KEY,
  );
}

export function isInboundConfigured(env: Env): boolean {
  return Boolean(env.INBOUND_DOMAIN && env.INBOUND_WEBHOOK_SECRET);
}

export function isUpiLensConfigured(env: Env): boolean {
  return Boolean(env.UPI_LENS_API_URL);
}

export function isAiConfigured(env: Env): boolean {
  if (env.AI_PROVIDER === 'anthropic') return Boolean(env.ANTHROPIC_API_KEY);
  if (env.AI_PROVIDER === 'gemini') return Boolean(env.GEMINI_API_KEY);
  return Boolean(env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY);
}
