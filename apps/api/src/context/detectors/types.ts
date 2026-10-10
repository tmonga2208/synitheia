import type { Types } from 'mongoose';
import type {
  Evidence,
  HabitMeasure,
  InferenceType,
  LocalDate,
  ProposedPayload,
} from '@synitheia/shared';
import type { PersonalEventDoc } from '../../db/models.js';

/** InferSchemaType omits _id; detectors cite event ids as evidence, so they need it. */
export type EventLean = PersonalEventDoc & { _id: Types.ObjectId };

/** A habit as a detector needs it: what it is, and how far along today is. */
export interface HabitToday {
  id: string;
  name: string;
  measure: HabitMeasure;
  frequency: 'daily' | 'weekly';
  targetCount: number;
  /** "HH:mm", or null when the habit has no reminder. */
  reminderTime: string | null;
  countToday: number;
}

/**
 * Everything a detector may look at, loaded once by the runner.
 *
 * Detectors are pure functions of this object. They do not query, and they do not read
 * the clock — `now` is handed in — which is what lets every rule be tested with plain
 * objects instead of a database and fake timers.
 */
export interface DetectorContext {
  userId: string;
  timezone: string;
  localDate: LocalDate;
  now: Date;
  /** The user's home currency, or null when the caller did not supply one. */
  currency: string | null;
  /** Today's events. */
  events: EventLean[];
  /** The 56 days before today, oldest data included. */
  history: EventLean[];
  /** Habits scheduled today, not archived. */
  habits: HabitToday[];
  /** Habits the user has rejected a completion suggestion for. */
  rejectedHabitIds: ReadonlySet<string>;
  waterTargetMl: number;
}

export interface Detection {
  /** Unique per (user, day). Per-habit detectors put the habit id in here. */
  detector: string;
  type: InferenceType;
  confidence: number;
  title: string;
  description: string | null;
  evidence: Evidence[];
  supportingEventIds: Types.ObjectId[];
  proposed: ProposedPayload;
}

export type Detector = (ctx: DetectorContext) => Detection[];
