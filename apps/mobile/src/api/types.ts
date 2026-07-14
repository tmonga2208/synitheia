import type {
  AIInsight,
  ConnectableSource,
  DraftTransaction,
  Expense,
  ExpenseCategory,
  ExpenseIngestion,
  Habit,
  Reminder,
  SupportingMetric,
} from '@synitheia/shared';

/**
 * What the API actually puts on the wire.
 *
 * `/today` is the only route that builds a DTO — it remaps `_id` → `id`. Everything
 * else returns lean Mongo documents verbatim, so the client sees `_id`, and every
 * field the zod schema types as a `Date` arrives as an ISO string. Reusing the domain
 * types here would be a lie the compiler believes right up until `.getTime()` throws
 * on a string, so the shapes are restated once, honestly, and shared from here.
 */

export interface ListResponse<T> {
  items: T[];
}

export interface WireHabit
  extends Omit<Habit, 'id' | 'archivedAt' | 'createdAt' | 'updatedAt'> {
  _id: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WireReminder
  extends Omit<Reminder, 'id' | 'lastFiredAt' | 'createdAt' | 'updatedAt'> {
  _id: string;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WireExpense
  extends Omit<Expense, 'id' | 'occurredAt' | 'createdAt' | 'updatedAt'> {
  _id: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface WireCategory extends Omit<ExpenseCategory, 'id' | 'createdAt'> {
  _id: string;
  createdAt: string;
}

export interface WireDraft extends Omit<DraftTransaction, 'occurredAt'> {
  occurredAt: string | null;
}

export interface WireIngestion
  extends Omit<ExpenseIngestion, 'id' | 'drafts' | 'createdAt' | 'expiresAt'> {
  _id: string;
  drafts: WireDraft[];
  createdAt: string;
  expiresAt: string;
}

export interface WireInsight
  extends Omit<AIInsight, 'id' | 'generatedAt' | 'expiresAt' | 'feedbackAt'> {
  _id: string;
  generatedAt: string;
  expiresAt: string;
  feedbackAt: string | null;
}

/** GET /insights/:id/evidence — the metrics we STORED, never a second model call. */
export interface InsightEvidence {
  summary: string;
  period: { start: string; end: string };
  metrics: SupportingMetric[];
  confidence: number;
  generatedAt: string;
}

export interface InsightAvailability {
  /** Whether the server has a model provider configured at all. */
  configured: boolean;
  /** Whether the user has opted in. Never true by default. */
  enabled: boolean;
  allowedSources: ConnectableSource[];
}

export type DataSourceStatus = 'connected' | 'disabled' | 'denied' | 'unavailable';

/** GET /data-sources. The copy lives on the server so it cannot drift from what we collect. */
export interface DataSourceItem {
  source: ConnectableSource;
  title: string;
  why: string;
  platforms: string;
  reliability: string;
  status: DataSourceStatus;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  eventCount: number;
  /** Collecting a source and letting a model reason about it are two separate consents. */
  aiAllowed: boolean;
  connectedAt: string | null;
}

/** GET /habits/:id/history — the real success rate, scored only against periods the habit existed for. */
export interface HabitHistory {
  logs: { localDate: string; count: number; targetCount: number; complete: boolean }[];
  scheduledPeriods: number;
  completedPeriods: number;
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
}
