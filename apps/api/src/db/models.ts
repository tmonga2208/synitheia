import {
  Schema,
  model,
  type HydratedDocumentFromSchema,
  type InferSchemaType,
} from 'mongoose';
import { HABIT_COLORS } from '@synitheia/shared';

/**
 * Mongoose models. Two rules hold everywhere in this file:
 *
 *  1. Every collection is userId-scoped, and every index leads with userId. There
 *     is no query in this system that legitimately spans users.
 *  2. Uniqueness that protects data integrity (dedupe, idempotency) is declared as
 *     a database index, never enforced in application code. Application code forgets;
 *     a unique index does not.
 */

const opts = { timestamps: true, versionKey: false } as const;

// ─── User ───────────────────────────────────────────────────────────────────

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    avatarUrl: { type: String, default: null },
    timezone: { type: String, required: true },
    currency: { type: String, required: true, default: 'INR' },
    xp: { type: Number, required: true, default: 0, min: 0 },

    /** Never selected by default — a stray `.find()` must not be able to return hashes. */
    passwordHash: { type: String, default: null, select: false },
    authProviders: { type: [String], required: true, default: ['password'] },
    appleSub: { type: String, default: null },
    googleSub: { type: String, default: null },

    onboardedAt: { type: Date, default: null },

    /**
     * Statement Inbox address token. High-entropy, secret, and never selected by default
     * (a stray `.find()` must not hand it out). Null until the user enables the inbox.
     */
    inboundToken: { type: String, default: null, select: false },
    inboundEnabledAt: { type: Date, default: null },
  },
  opts,
);

userSchema.index({ email: 1 }, { unique: true });

/**
 * Partial, NOT sparse.
 *
 * `sparse` only skips documents where the field is ABSENT. These fields default to
 * null, so they are present-and-null on every password user — under a sparse unique
 * index the second such signup collides with the first on `appleSub: null`. A partial
 * index restricted to actual string values is the correct construct, and the only one
 * that lets many users share "no Apple account" while still enforcing that one Apple
 * identity maps to one user.
 */
userSchema.index(
  { appleSub: 1 },
  { unique: true, partialFilterExpression: { appleSub: { $type: 'string' } } },
);
userSchema.index(
  { googleSub: 1 },
  { unique: true, partialFilterExpression: { googleSub: { $type: 'string' } } },
);
userSchema.index(
  { inboundToken: 1 },
  { unique: true, partialFilterExpression: { inboundToken: { $type: 'string' } } },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const UserModel = model('User', userSchema);

// ─── XP ─────────────────────────────────────────────────────────────────────

const xpAwardSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /**
     * What was earned, as a stable string — `habit:<id>:<localDate>`, `day:<localDate>`,
     * `streak:<id>:<milestone>`, `budget:<YYYY-MM>`. Unique per user, and that uniqueness
     * IS the idempotence: a replayed tap, an optimistic retry or an offline sync collides
     * here and becomes a no-op. Nothing in the award path checks-then-inserts, because
     * that races.
     */
    key: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    awardedAt: { type: Date, required: true, default: () => new Date() },
  },
  opts,
);

xpAwardSchema.index({ userId: 1, key: 1 }, { unique: true });

export type XpAwardDoc = InferSchemaType<typeof xpAwardSchema>;
export const XpAwardModel = model('XpAward', xpAwardSchema);

// ─── Refresh tokens ─────────────────────────────────────────────────────────

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** SHA-256 of the token. A database leak must not yield usable sessions. */
    tokenHash: { type: String, required: true },
    /** Rotation lineage — see auth/tokens.ts for why reuse detection needs this. */
    family: { type: String, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String, default: null },
  },
  opts,
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1, family: 1 });
// Mongo reaps expired sessions for us; no cron needed.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshTokenDoc = InferSchemaType<typeof refreshTokenSchema>;
export const RefreshTokenModel = model(
  'RefreshToken',
  refreshTokenSchema,
);

// ─── Preferences ────────────────────────────────────────────────────────────

const userPreferenceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    /**
     * The trackers the user chose during onboarding. Decides what the Daily Flow ring is
     * scored against — see the note in shared/user.ts for why defaulting this wrong made
     * the ring unreachable for anyone who did not track water.
     */
    trackedDomains: {
      type: [String],
      required: true,
      default: ['habits', 'expenses', 'nutrition', 'water'],
    },

    waterTargetMl: { type: Number, required: true, default: 2500 },
    calorieTarget: { type: Number, required: true, default: 2000 },
    proteinTargetG: { type: Number, required: true, default: 60 },
    monthlyBudgetMinor: { type: Number, default: null },
    reminderDefaultTime: { type: String, required: true, default: '19:30' },
    notificationsEnabled: { type: Boolean, required: true, default: true },

    /**
     * The body, as read from Apple Health (or typed in when Health does not hold it).
     *
     * Nullable all the way down, and deliberately so: a missing height must stay missing.
     * Substituting a population average would turn "we cannot compute your calories" into a
     * confident number the user then eats to. See bodyInsight() in shared/health.ts.
     */
    bodyMetrics: {
      heightCm: { type: Number, default: null },
      weightKg: { type: Number, default: null },
      biologicalSex: { type: String, default: null, enum: ['male', 'female', 'other', null] },
      birthDate: { type: String, default: null },
      updatedAt: { type: Date, default: null },
    },

    /** null until the user picks one. A calorie goal is never inferred on their behalf. */
    calorieGoal: { type: String, default: null, enum: ['lose', 'maintain', 'gain', null] },

    aiEnabled: { type: Boolean, required: true, default: false },
    aiAllowedSources: { type: [String], required: true, default: [] },
    aiIncludeNotes: { type: Boolean, required: true, default: false },

    /** Opt-in. The user is asked the first time they attach a receipt. */
    storeReceipts: { type: Boolean, required: true, default: false },
  },
  opts,
);

userPreferenceSchema.index({ userId: 1 }, { unique: true });

export type UserPreferenceDoc = InferSchemaType<typeof userPreferenceSchema>;
export const UserPreferenceModel = model(
  'UserPreference',
  userPreferenceSchema,
);

// ─── Expenses ───────────────────────────────────────────────────────────────

const expenseCategorySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    icon: { type: String, required: true },
    color: { type: String, required: true },
    isSystem: { type: Boolean, required: true, default: false },
  },
  opts,
);

expenseCategorySchema.index({ userId: 1, name: 1 }, { unique: true });

export type ExpenseCategoryDoc = InferSchemaType<typeof expenseCategorySchema>;
export const ExpenseCategoryModel = model(
  'ExpenseCategory',
  expenseCategorySchema,
);

const expenseSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    /**
     * Integer minor units (paise). Mongo would happily store a float here and the
     * app would happily lose a paise per row; the validator is the last line of
     * defence behind the zod schema at the edge.
     */
    amountMinor: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: 'amountMinor must be an integer count of minor units, not a float',
      },
    },
    currency: { type: String, required: true },

    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    /** Denormalized for list rendering. See expense.ts in shared for the rationale. */
    categoryName: { type: String, required: true },
    categoryColor: { type: String, required: true },

    merchant: { type: String, default: null, trim: true },
    note: { type: String, default: null },

    occurredAt: { type: Date, required: true },
    timezone: { type: String, required: true },
    localDate: { type: String, required: true },

    source: { type: String, required: true, default: 'manual' },
    ingestionId: { type: Schema.Types.ObjectId, default: null },

    /** Set when a receipt image is attached. The bytes live in ImageKit. */
    hasReceipt: { type: Boolean, required: true, default: false },

    /**
     * Who paid the venue. Null means you did.
     *
     * `amountMinor` above is ALWAYS what you are out — the full bill if you paid it, your
     * share alone if someone else did. Recording ₹1,000 for a dinner a friend covered
     * would quadruple your Friday spending on a meal you barely paid for.
     */
    paidBy: {
      type: {
        _id: false,
        name: { type: String, required: true },
        contactId: { type: String, default: null },
      },
      default: null,
    },
    /** The full bill, when it was bigger than your share. Null when you paid it all. */
    billAmountMinor: { type: Number, default: null },

    /**
     * People who owe you part of this. Empty for the common case.
     *
     * `amountMinor` above is what left your account and never changes. What the expense
     * COST you is amountMinor minus the shares that have actually been paid back — see
     * netMinor() in shared. Storing the net would destroy the record of what you paid.
     */
    participants: {
      type: [
        {
          _id: false,
          name: { type: String, required: true },
          contactId: { type: String, default: null },
          shareMinor: {
            type: Number,
            required: true,
            validate: {
              validator: Number.isInteger,
              message: 'shareMinor must be an integer count of minor units',
            },
          },
          settledAt: { type: Date, default: null },
        },
      ],
      default: [],
    },
  },
  opts,
);

expenseSchema.index({ userId: 1, localDate: -1, occurredAt: -1 });
// Powers the "who owes me" screen without scanning every expense the user has ever made.
expenseSchema.index({ userId: 1, 'participants.settledAt': 1 });
expenseSchema.index({ userId: 1, categoryId: 1, occurredAt: -1 });

export type ExpenseDoc = InferSchemaType<typeof expenseSchema>;
export type ExpenseHydrated = HydratedDocumentFromSchema<typeof expenseSchema>;
export const ExpenseModel = model('Expense', expenseSchema);

const expenseIngestionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: String, required: true },
    status: { type: String, required: true, default: 'parsing' },
    drafts: { type: [Schema.Types.Mixed], required: true, default: [] },
    error: { type: String, default: null },
    /** Provider Message-ID, for idempotency against retries. Null for non-email channels. */
    messageId: { type: String, default: null },
    /** Display metadata for email-sourced ingestions: { from, subject, receivedAt }. */
    source: { type: Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  opts,
);

expenseIngestionSchema.index({ userId: 1, status: 1, createdAt: -1 });
// Unreviewed drafts are transient by design — a screenshot from three weeks ago is noise.
expenseIngestionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
expenseIngestionSchema.index(
  { userId: 1, messageId: 1 },
  { unique: true, partialFilterExpression: { messageId: { $type: 'string' } } },
);

export type ExpenseIngestionDoc = InferSchemaType<typeof expenseIngestionSchema>;
export const ExpenseIngestionModel = model(
  'ExpenseIngestion',
  expenseIngestionSchema,
);

// ─── Habits ─────────────────────────────────────────────────────────────────

const habitSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    icon: { type: String, required: true },
    color: { type: String, required: true, enum: HABIT_COLORS },
    category: { type: String, default: null },

    frequency: { type: String, required: true, enum: ['daily', 'weekly'] },

    /**
     * What the count means. Habits written before this field existed have no value for it,
     * and `.lean()` does NOT apply the default on read — so every consumer goes through
     * `measureOf()`, which treats a missing measure as the old behaviour: a plain check.
     */
    measure: {
      type: String,
      required: true,
      default: 'check',
      enum: ['check', 'count', 'duration', 'steps'],
    },
    targetCount: { type: Number, required: true, default: 1, min: 1, max: 100_000 },
    unit: { type: String, default: null },
    reminderTime: { type: String, default: null },

    /** Caches. HabitLog is authoritative; these are recomputed on every write. */
    currentStreak: { type: Number, required: true, default: 0 },
    longestStreak: { type: Number, required: true, default: 0 },

    /** Soft-archive. Deleting a habit would orphan the user's history. */
    archivedAt: { type: Date, default: null },
  },
  opts,
);

habitSchema.index({ userId: 1, archivedAt: 1 });

export type HabitDoc = InferSchemaType<typeof habitSchema>;
export type HabitHydrated = HydratedDocumentFromSchema<typeof habitSchema>;
export const HabitModel = model('Habit', habitSchema);

const habitLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    habitId: { type: Schema.Types.ObjectId, ref: 'Habit', required: true },
    localDate: { type: String, required: true },
    count: { type: Number, required: true, default: 0, min: 0 },
    targetCount: { type: Number, required: true, min: 1 },
    completedAt: { type: Date, default: null },
    source: { type: String, required: true, default: 'manual' },
  },
  opts,
);

/**
 * THE idempotency guarantee for habits. A double-tapped checkbox, a retried request
 * on a flaky train connection, or an offline queue replaying on reconnect all hit
 * this index and update the same row instead of inflating a streak. Without it, the
 * headline number in the app is quietly a lie.
 */
habitLogSchema.index({ userId: 1, habitId: 1, localDate: 1 }, { unique: true });
habitLogSchema.index({ userId: 1, localDate: 1 });

export type HabitLogDoc = InferSchemaType<typeof habitLogSchema>;
export const HabitLogModel = model('HabitLog', habitLogSchema);

// ─── Nutrition ──────────────────────────────────────────────────────────────

const macros = {
  calories: { type: Number, required: true, default: 0 },
  proteinG: { type: Number, required: true, default: 0 },
  carbsG: { type: Number, required: true, default: 0 },
  fatG: { type: Number, required: true, default: 0 },
};

const foodEntrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    mealType: {
      type: String,
      required: true,
      enum: ['breakfast', 'lunch', 'dinner', 'snack'],
    },
    servings: { type: Number, required: true, default: 1, min: 0 },
    /** Snapshot for `servings`, not a live lookup — history must not mutate. */
    macros: { type: macros, required: true },
    foodRef: { type: String, default: null },

    loggedAt: { type: Date, required: true },
    timezone: { type: String, required: true },
    localDate: { type: String, required: true },
    source: { type: String, required: true, default: 'manual' },
  },
  opts,
);

foodEntrySchema.index({ userId: 1, localDate: 1, mealType: 1 });

export type FoodEntryDoc = InferSchemaType<typeof foodEntrySchema>;
export const FoodEntryModel = model('FoodEntry', foodEntrySchema);

const dailyNutritionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    localDate: { type: String, required: true },
    totals: { type: macros, required: true },
    byMeal: { type: Schema.Types.Mixed, required: true, default: {} },
    entryCount: { type: Number, required: true, default: 0 },
  },
  opts,
);

dailyNutritionSchema.index({ userId: 1, localDate: 1 }, { unique: true });

export type DailyNutritionDoc = InferSchemaType<typeof dailyNutritionSchema>;
export const DailyNutritionModel = model(
  'DailyNutrition',
  dailyNutritionSchema,
);

// ─── Water ──────────────────────────────────────────────────────────────────

const waterEntrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amountMl: { type: Number, required: true, min: 1 },
    loggedAt: { type: Date, required: true },
    timezone: { type: String, required: true },
    localDate: { type: String, required: true },
    source: { type: String, required: true, default: 'manual' },
    /** Client-supplied idempotency key — water is the most double-tapped button in the app. */
    clientKey: { type: String, default: null },
  },
  opts,
);

waterEntrySchema.index({ userId: 1, localDate: 1 });
// Partial, not sparse — clientKey defaults to null, and a sparse unique index would
// let the FIRST unkeyed entry through and then reject every one after it.
waterEntrySchema.index(
  { userId: 1, clientKey: 1 },
  { unique: true, partialFilterExpression: { clientKey: { $type: 'string' } } },
);

export type WaterEntryDoc = InferSchemaType<typeof waterEntrySchema>;
export const WaterEntryModel = model('WaterEntry', waterEntrySchema);

// ─── Reminders ──────────────────────────────────────────────────────────────

const reminderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, required: true },
    refId: { type: Schema.Types.ObjectId, default: null },
    label: { type: String, required: true },
    time: { type: String, required: true },
    weekdays: { type: [Number], required: true, default: [] },
    enabled: { type: Boolean, required: true, default: true },
    lastFiredAt: { type: Date, default: null },
  },
  opts,
);

reminderSchema.index({ userId: 1, enabled: 1 });

export type ReminderDoc = InferSchemaType<typeof reminderSchema>;
export const ReminderModel = model('Reminder', reminderSchema);

// ─── Personal events (the normalized timeline) ──────────────────────────────

const personalEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    source: { type: String, required: true },

    timestamp: { type: Date, required: true },
    timezone: { type: String, required: true },
    localDate: { type: String, required: true },

    confidence: { type: Number, required: true, default: 1, min: 0, max: 1 },
    refId: { type: Schema.Types.ObjectId, default: null },

    /** See below — this index is the entire dedupe story. */
    dedupeKey: { type: String, required: true },

    metadata: { type: Schema.Types.Mixed, required: true },
  },
  opts,
);

/**
 * The dedupe guarantee for the whole context engine.
 *
 * Passive sources are replayed constantly: HealthKit re-delivers a day's steps on
 * every background wake, a calendar re-syncs the same event, an offline client
 * flushes a queue twice. Without this index the timeline slowly fills with
 * duplicates, every aggregate double-counts, and the AI reports that the user walked
 * 40,000 steps. Enforcing it in Mongo means no code path can forget.
 */
personalEventSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
personalEventSchema.index({ userId: 1, localDate: -1, timestamp: -1 });
personalEventSchema.index({ userId: 1, type: 1, timestamp: -1 });

export type PersonalEventDoc = InferSchemaType<typeof personalEventSchema>;
export const PersonalEventModel = model(
  'PersonalEvent',
  personalEventSchema,
);

// ─── Inference ──────────────────────────────────────────────────────────────

const inferredContextSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    detector: { type: String, required: true },

    title: { type: String, required: true },
    description: { type: String, default: null },

    supportingEventIds: { type: [Schema.Types.ObjectId], default: [] },
    evidence: { type: [Schema.Types.Mixed], default: [] },
    proposed: { type: Schema.Types.Mixed, required: true },

    status: { type: String, required: true, default: 'pending' },
    localDate: { type: String, required: true },

    expiresAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    correction: { type: Schema.Types.Mixed, default: null },
  },
  opts,
);

inferredContextSchema.index({ userId: 1, status: 1, createdAt: -1 });
inferredContextSchema.index({ userId: 1, localDate: 1 });
// A detector must not ask the same question twice on the same day.
inferredContextSchema.index(
  { userId: 1, detector: 1, localDate: 1 },
  { unique: true },
);

export type InferredContextDoc = InferSchemaType<typeof inferredContextSchema>;
export const InferredContextModel = model(
  'InferredContext',
  inferredContextSchema,
);

// ─── Summaries, connections, insights ───────────────────────────────────────

const dailySummarySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    localDate: { type: String, required: true },
    expenses: { type: Schema.Types.Mixed, required: true },
    habits: { type: Schema.Types.Mixed, required: true },
    nutrition: { type: Schema.Types.Mixed, required: true },
    water: { type: Schema.Types.Mixed, required: true },
    activity: { type: Schema.Types.Mixed, required: true },
    context: { type: Schema.Types.Mixed, required: true },
    eventCount: { type: Number, required: true, default: 0 },
    sources: { type: [String], default: [] },
    generatedAt: { type: Date, required: true },
  },
  opts,
);

dailySummarySchema.index({ userId: 1, localDate: 1 }, { unique: true });

export type DailySummaryDoc = InferSchemaType<typeof dailySummarySchema>;
export const DailySummaryModel = model(
  'DailySummary',
  dailySummarySchema,
);

const dataSourceConnectionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    source: { type: String, required: true },
    status: { type: String, required: true, default: 'disabled' },
    grantedScopes: { type: [String], default: [] },
    lastSyncedAt: { type: Date, default: null },
    lastSyncError: { type: String, default: null },
    eventCount: { type: Number, required: true, default: 0 },
    /** Consent to *collect* and consent to *reason about* are separate decisions. */
    aiAllowed: { type: Boolean, required: true, default: false },
    connectedAt: { type: Date, default: null },
  },
  opts,
);

dataSourceConnectionSchema.index({ userId: 1, source: 1 }, { unique: true });

export type DataSourceConnectionDoc = InferSchemaType<typeof dataSourceConnectionSchema>;
export const DataSourceConnectionModel = model(
  'DataSourceConnection',
  dataSourceConnectionSchema,
);

/**
 * One local day of health, as the device reported it.
 *
 * A per-DAY row, not a stream of samples: the app never needs to know you took 43 steps at
 * 09:14. The unique (userId, localDate) index IS the idempotency guarantee — Health is
 * re-read on every foreground, and yesterday's steps keep changing until midnight, so the
 * same day gets written many times and must never accumulate duplicates.
 */
const healthDaySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    localDate: { type: String, required: true },

    steps: { type: Number, default: null },
    /** Energy burned ABOVE resting — HealthKit's definition. It excludes BMR. */
    activeEnergyKcal: { type: Number, default: null },
    exerciseMinutes: { type: Number, default: null },
    sleepMinutes: { type: Number, default: null },
    restingHeartRate: { type: Number, default: null },

    workouts: [
      {
        _id: false,
        kind: { type: String, required: true },
        minutes: { type: Number, required: true },
        energyKcal: { type: Number, default: null },
      },
    ],

    syncedAt: { type: Date, required: true, default: () => new Date() },
  },
  opts,
);

healthDaySchema.index({ userId: 1, localDate: 1 }, { unique: true });

export type HealthDayDoc = InferSchemaType<typeof healthDaySchema>;
export const HealthDayModel = model('HealthDay', healthDaySchema);

const aiInsightSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    severity: { type: String, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },

    /** The exact numbers the model was shown. "Why am I seeing this?" reads these. */
    supportingMetrics: { type: [Schema.Types.Mixed], required: true },
    supportingEventIds: { type: [Schema.Types.ObjectId], default: [] },
    evidenceSummary: { type: String, required: true },

    periodStart: { type: String, required: true },
    periodEnd: { type: String, required: true },

    generatedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },

    status: { type: String, required: true, default: 'active' },
    userFeedback: { type: String, default: null },
    feedbackAt: { type: Date, default: null },
  },
  opts,
);

aiInsightSchema.index({ userId: 1, status: 1, generatedAt: -1 });
aiInsightSchema.index({ userId: 1, periodStart: 1, periodEnd: 1, type: 1 });

export type AIInsightDoc = InferSchemaType<typeof aiInsightSchema>;
export const AIInsightModel = model('AIInsight', aiInsightSchema);

// ─── Food photo ingestion ───────────────────────────────────────────────────

const foodIngestionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, required: true, default: 'needs_review' },
    mealType: { type: String, required: true },
    /** Draft items only. The photograph itself is never persisted — see vision.ts. */
    items: { type: [Schema.Types.Mixed], required: true, default: [] },
    caveat: { type: String, default: null },
    error: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  opts,
);

foodIngestionSchema.index({ userId: 1, status: 1, createdAt: -1 });
// Unreviewed drafts are transient — an estimate for a meal eaten two days ago is noise.
foodIngestionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type FoodIngestionDoc = InferSchemaType<typeof foodIngestionSchema>;
export const FoodIngestionModel = model('FoodIngestion', foodIngestionSchema);

// ─── Subscriptions ──────────────────────────────────────────────────────────

const subscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    amountMinor: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: 'amountMinor must be an integer count of minor units',
      },
    },
    currency: { type: String, required: true },

    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    categoryName: { type: String, required: true },
    categoryColor: { type: String, required: true },

    cycle: { type: String, required: true, enum: ['weekly', 'monthly', 'quarterly', 'yearly'] },

    /** An ANCHOR, never "the last date we posted". See nextDueAfter() for why. */
    anchorDay: { type: Number, required: true, min: 0, max: 31 },
    anchorMonth: { type: Number, default: null },

    nextDueDate: { type: String, required: true },
    /** The last local date an expense was actually posted for. The double-post guard. */
    lastPostedDate: { type: String, default: null },

    autoPost: { type: Boolean, required: true, default: true },
    archivedAt: { type: Date, default: null },
  },
  opts,
);

subscriptionSchema.index({ userId: 1, archivedAt: 1 });
// The posting sweep asks one question — "what is due?" — and this answers it directly.
subscriptionSchema.index({ userId: 1, nextDueDate: 1, archivedAt: 1 });

export type SubscriptionDoc = InferSchemaType<typeof subscriptionSchema>;
export type SubscriptionHydrated = HydratedDocumentFromSchema<typeof subscriptionSchema>;
export const SubscriptionModel = model('Subscription', subscriptionSchema);

// ─── Receipts ───────────────────────────────────────────────────────────────

/**
 * The image behind an expense: a photographed receipt, or the payment screenshot it was
 * scanned from.
 *
 * A deliberate reversal of the rule used for food photos, which are sent to the model and
 * then dropped. The difference is what the image is FOR. A food photo is an input to an
 * estimate — once the calories are known, the picture buys the user nothing and keeping a
 * library of what someone eats is a liability. A receipt is EVIDENCE: it is the thing you
 * reach for when you cannot remember what a ₹4,200 charge was, or when you need to prove
 * it. Storing it is the point.
 *
 * Kept in its own collection rather than on the Expense so that listing a month of
 * expenses does not drag megabytes of image data through every query.
 */
const receiptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expenseId: { type: Schema.Types.ObjectId, ref: 'Expense', required: true },
    contentType: { type: String, required: true },
    /**
     * The image lives in ImageKit, not here. Mongo stores the pointer.
     *
     * Keeping binary in the database bloats every backup and drags megabytes through
     * queries that never wanted them — and a receipt is exactly the kind of thing you
     * want on a CDN with a signed, expiring URL rather than streamed through the API.
     */
    fileId: { type: String, required: true },
    filePath: { type: String, required: true },
    byteSize: { type: Number, required: true },
  },
  opts,
);

receiptSchema.index({ userId: 1, expenseId: 1 }, { unique: true });

export type ReceiptDoc = InferSchemaType<typeof receiptSchema>;
export const ReceiptModel = model('Receipt', receiptSchema);
