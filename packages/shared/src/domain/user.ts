import { z } from 'zod';
import {
  connectableSourceSchema,
  currencySchema,
  isoInstantSchema,
  objectIdSchema,
  timeOfDaySchema,
  timeZoneSchema,
} from './common.js';

export const authProviderSchema = z.enum(['password', 'apple', 'google']);
export type AuthProvider = z.infer<typeof authProviderSchema>;

export const userSchema = z.object({
  id: objectIdSchema,
  email: z.string().email(),
  name: z.string().min(1).max(80),
  avatarUrl: z.string().url().nullable(),
  timezone: timeZoneSchema,
  currency: currencySchema,
  xp: z.number().int().nonnegative(),
  authProviders: z.array(authProviderSchema).min(1),
  onboardedAt: isoInstantSchema.nullable(),
  createdAt: isoInstantSchema,
});
export type User = z.infer<typeof userSchema>;

/**
 * Targets and settings, split from User so that the AI/privacy toggles have their
 * own audit surface — flipping `aiEnabled` is a consent decision and should not be
 * buried in the same document as the user's display name.
 */
/** The trackers a user actually signed up for. Everything else stays out of their way. */
export const trackedDomainSchema = z.enum(['habits', 'expenses', 'nutrition', 'water']);
export type TrackedDomain = z.infer<typeof trackedDomainSchema>;

export const userPreferenceSchema = z.object({
  userId: objectIdSchema,

  /**
   * Which trackers the user chose. This is the single most load-bearing thing onboarding
   * collects, because it decides what the Daily Flow ring is scored against.
   *
   * Without it, the ring counted water for everybody — `waterTargetMl` always has a
   * default, so "has a target" was always true — and a user who only tracks habits could
   * complete every one of them and still sit at 50%, dragged down by a tracker they never
   * asked for. A ring that cannot be filled is a ring quietly telling you that you failed.
   */
  trackedDomains: z.array(trackedDomainSchema).min(1),

  waterTargetMl: z.number().int().min(250).max(10_000),
  calorieTarget: z.number().int().min(800).max(10_000),
  proteinTargetG: z.number().int().min(0).max(500),
  monthlyBudgetMinor: z.number().int().nonnegative().nullable(),

  weekStartsOn: z.literal(1), // Monday, matching the M–S weekly chart
  reminderDefaultTime: timeOfDaySchema,
  notificationsEnabled: z.boolean(),

  /**
   * The master AI consent switch. When false, no AI context is ever built and no
   * request is ever made to a model provider — the check happens before the context
   * builder runs, not inside it, so there is no code path where data leaks.
   */
  aiEnabled: z.boolean(),
  /**
   * Per-source AI consent, as a copy. A user may be happy for Synítheia to reason about
   * their habits but not their location. The record that decides is each source's
   * connection row (`aiAllowed`, the switch on Connected Context); this list is rebuilt
   * from those rows after every change so the export can show it, and nothing reads it
   * to decide what the model gets.
   */
  aiAllowedSources: z.array(connectableSourceSchema),
  /** Free-text notes on expenses/food can contain anything. Off by default. */
  aiIncludeNotes: z.boolean(),

  /**
   * Keep a copy of receipt images on the server.
   *
   * Off by default, and the user is asked the first time they try to attach one. A
   * receipt is genuinely useful to keep — it is what you reach for when you cannot
   * remember what a ₹4,200 charge was — but it is also a picture of where you were and
   * what you bought, and that is not a thing to start storing without asking.
   *
   * When off, a scanned screenshot is still read to extract the transaction and then
   * dropped. The feature works; the image simply does not persist.
   */
  storeReceipts: z.boolean(),

  updatedAt: isoInstantSchema,
});
export type UserPreference = z.infer<typeof userPreferenceSchema>;

export const DEFAULT_PREFERENCES = {
  // Everything, until onboarding narrows it. Existing accounts predate the question and
  // must keep behaving exactly as they did.
  trackedDomains: ['habits', 'expenses', 'nutrition', 'water'],
  waterTargetMl: 2500,
  calorieTarget: 2000,
  proteinTargetG: 60,
  monthlyBudgetMinor: null,
  weekStartsOn: 1,
  reminderDefaultTime: '19:30',
  notificationsEnabled: true,
  aiEnabled: false, // opt-in, never opt-out
  aiAllowedSources: [],
  aiIncludeNotes: false,
  storeReceipts: false, // asked on first use, never assumed
} as const;

// ─── Onboarding ─────────────────────────────────────────────────────────────

/**
 * What onboarding sends, in one shot.
 *
 * One request, not five. A setup split across "create habit", "create habit", "set
 * preferences", "mark onboarded" can fail halfway and strand a user with two habits, no
 * targets, and a Today screen that thinks they never finished — with no way back, because
 * onboarding does not run twice.
 */
export const completeOnboardingSchema = z.object({
  trackedDomains: z.array(trackedDomainSchema).min(1),

  /** Starter habits, already carrying their icon and colour. */
  habits: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        icon: z.string().min(1),
        color: z.string(),
      }),
    )
    .max(8)
    .default([]),

  waterTargetMl: z.number().int().min(250).max(10_000).optional(),
  calorieTarget: z.number().int().min(800).max(10_000).optional(),
  monthlyBudgetMinor: z.number().int().nonnegative().nullish(),
  currency: currencySchema.optional(),

  /** One nudge a day, at a time they chose. Null means they said no. */
  reminderTime: timeOfDaySchema.nullish(),
});
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;

/**
 * Editing targets AFTER onboarding — the "Targets" screen.
 *
 * Deliberately NOT the onboarding flow. Reusing /setup here would drag the user back
 * through domain and habit selection, and the guard that keeps onboarded users out of
 * onboarding would bounce them to Today before they saw a single field. This is a small,
 * standalone update: only the numbers, each optional, so the screen can save just what
 * changed. Bounds mirror onboarding — a 250ml daily water goal is a typo, not a choice.
 */
export const updateTargetsSchema = z
  .object({
    waterTargetMl: z.number().int().min(250).max(10_000).optional(),
    calorieTarget: z.number().int().min(800).max(10_000).optional(),
    monthlyBudgetMinor: z.number().int().nonnegative().nullable().optional(),
    /** Setup's choice, changeable later from Targets. At least one, each named once. */
    trackedDomains: z
      .array(trackedDomainSchema)
      .min(1)
      .refine((d) => new Set(d).size === d.length, {
        message: 'Each area once',
      })
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateTargetsInput = z.infer<typeof updateTargetsSchema>;

/** What the Targets screen reads to prefill — the current numbers and which domains apply. */
export interface TargetsView {
  trackedDomains: TrackedDomain[];
  waterTargetMl: number;
  calorieTarget: number;
  monthlyBudgetMinor: number | null;
  currency: string;
}

/**
 * Starter habits offered during onboarding.
 *
 * A curated few, not a blank field. The single most important thing onboarding does is
 * ensure Today is NOT empty on day one — an empty ring at 0% with no habits is the app
 * failing to demonstrate its own premise at the exact moment it has to. Picking from a
 * list is one tap; inventing a habit from nothing is a decision most people defer.
 */
export const STARTER_HABITS = [
  // Icon names are the lucide COMPONENT names, matching what the icon picker stores.
  { name: 'Read', icon: 'BookOpen', color: '#7D8FA9' },
  { name: 'Walk', icon: 'Footprints', color: '#7D927D' },
  { name: 'Meditate', icon: 'Brain', color: '#A98DA9' },
  { name: 'Exercise', icon: 'Dumbbell', color: '#C08A7D' },
  { name: 'Sleep early', icon: 'Moon', color: '#7DA095' },
  { name: 'Journal', icon: 'PenLine', color: '#B08A8A' },
  { name: 'Stretch', icon: 'Waves', color: '#B0917D' },
  { name: 'Eat well', icon: 'Salad', color: '#8A9AA9' },
] as const;
