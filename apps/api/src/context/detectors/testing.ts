import { Types } from 'mongoose';
import { asLocalDate, toLocalDate } from '@synitheia/shared';
import type { DetectorContext, EventLean } from './types.js';

/**
 * Test-only builders. Detectors are pure, so most of their tests need objects, not Mongo.
 * Imported only from *.test.ts files.
 */

export const TEST_TZ = 'Asia/Kolkata';
/** A Sunday. `localWeekdayIndex` → 6. */
export const TEST_DAY = asLocalDate('2026-07-12');

/** An instant at `HH:mm` IST on `day`. IST is UTC+5:30 with no DST, so this is exact. */
export function istAt(localTime: string, day: string = TEST_DAY): Date {
  const [h, m] = localTime.split(':').map(Number) as [number, number];
  const utcMinutes = h * 60 + m - (5 * 60 + 30);
  return new Date(Date.parse(`${day}T00:00:00Z`) + utcMinutes * 60_000);
}

export function fakeEvent(input: {
  type: string;
  at: Date;
  metadata?: Record<string, unknown>;
  source?: string;
  /** When the row was last written. Defaults to `at`. */
  updatedAt?: Date;
}): EventLean {
  return {
    _id: new Types.ObjectId(),
    type: input.type,
    source: input.source ?? 'manual',
    timestamp: input.at,
    timezone: TEST_TZ,
    localDate: toLocalDate(input.at, TEST_TZ),
    updatedAt: input.updatedAt ?? input.at,
    metadata: { type: input.type, ...(input.metadata ?? {}) },
  } as unknown as EventLean;
}

export function baseCtx(overrides: Partial<DetectorContext> = {}): DetectorContext {
  return {
    userId: new Types.ObjectId().toString(),
    timezone: TEST_TZ,
    localDate: TEST_DAY,
    now: istAt('20:00'),
    currency: 'INR',
    events: [],
    history: [],
    habits: [],
    rejectedHabitIds: new Set(),
    waterTargetMl: 2500,
    ...overrides,
  };
}
