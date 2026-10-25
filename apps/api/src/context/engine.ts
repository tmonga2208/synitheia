import { Types, type ClientSession } from 'mongoose';
import {
  toLocalDate,
  type DataSource,
  type EventMetadata,
  type EventType,
} from '@synitheia/shared';
import { PersonalEventModel, type PersonalEventDoc } from '../db/models.js';

/**
 * The Personal Context Engine.
 *
 * Every meaningful thing that happens to a user — typed, imported, sensed, or
 * inferred — becomes exactly one normalized PersonalEvent here. The Today timeline,
 * the daily aggregator, and the AI context builder then read one uniform stream
 * instead of joining nine collections with nine different shapes.
 *
 * Three properties this module is responsible for, in order of importance:
 *
 *   1. NORMALIZATION.  One event model, one timestamp convention, one timezone rule.
 *   2. IDEMPOTENCY.    Emitting the same logical event twice is a no-op, always.
 *   3. ATOMICITY.      A domain write and its event either both land or neither does.
 *
 * What it deliberately is NOT: a message broker. There is one API process; a Kafka
 * topic here would be architecture theatre. The `emit` surface is narrow enough that
 * swapping the transport later touches this file and nothing else.
 */

export interface EmitInput<T extends EventMetadata = EventMetadata> {
  userId: string | Types.ObjectId;
  source: DataSource;
  /** When it actually happened — not when we heard about it. */
  timestamp: Date;
  /** The user's timezone at that moment. History stays anchored to where it happened. */
  timezone: string;
  metadata: T;
  /** See dedupeKey(). Must be stable across retries and re-syncs. */
  dedupeKey: string;
  refId?: string | Types.ObjectId | null;
  /** 1.0 for anything the user did or confirmed. Below 1.0 only for passive detection. */
  confidence?: number;
}

/**
 * Build a stable natural key for an event.
 *
 * The rule: the key must be derivable purely from the *thing that happened*, with no
 * reference to when we processed it. `health:steps:2026-07-12` is correct — HealthKit
 * will re-deliver Sunday's steps on every background wake for days, and each delivery
 * must collapse onto the same row. Anything involving Date.now() or a random id is
 * wrong by construction and will silently duplicate.
 */
export function dedupeKey(source: DataSource, kind: string, discriminator: string): string {
  return `${source}:${kind}:${discriminator}`;
}

function eventTypeOf(metadata: EventMetadata): EventType {
  return metadata.type;
}

export interface EmitResult {
  event: PersonalEventDoc & { _id: Types.ObjectId };
  /** False when this event already existed — the caller emitted a duplicate. */
  created: boolean;
}

/**
 * Emit one normalized event.
 *
 * Idempotent on (userId, dedupeKey), enforced by a unique index rather than by a
 * read-then-write, which would race under concurrency. Re-emitting an existing event
 * updates its mutable fields (a step count that grew during the day) and reports
 * created: false.
 */
export async function emit(
  input: EmitInput,
  session?: ClientSession,
): Promise<EmitResult> {
  const userId = new Types.ObjectId(input.userId);
  const localDate = toLocalDate(input.timestamp, input.timezone);

  const doc = {
    userId,
    type: eventTypeOf(input.metadata),
    source: input.source,
    timestamp: input.timestamp,
    timezone: input.timezone,
    localDate,
    confidence: input.confidence ?? 1,
    refId: input.refId ? new Types.ObjectId(input.refId) : null,
    dedupeKey: input.dedupeKey,
    metadata: input.metadata,
  };

  // upsert + the unique index = idempotency that survives concurrent writers.
  const before = await PersonalEventModel.findOne(
    { userId, dedupeKey: input.dedupeKey },
    { _id: 1 },
    { session },
  ).lean();

  const event = await PersonalEventModel.findOneAndUpdate(
    { userId, dedupeKey: input.dedupeKey },
    { $set: doc },
    { upsert: true, new: true, session },
  );

  return {
    event: event as PersonalEventDoc & { _id: Types.ObjectId },
    created: before === null,
  };
}

/** Emit many events, collapsing duplicates. Used by passive-source syncs. */
export async function emitMany(
  inputs: readonly EmitInput[],
  session?: ClientSession,
): Promise<{ created: number; updated: number }> {
  if (inputs.length === 0) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;
  for (const input of inputs) {
    const result = await emit(input, session);
    if (result.created) created += 1;
    else updated += 1;
  }
  return { created, updated };
}

/**
 * Retract an event when its owning domain record is deleted.
 *
 * The timeline is a projection, not an immutable ledger of the universe — if a user
 * deletes an expense they logged by mistake, it must vanish from Today too, or the
 * app is visibly lying to them.
 */
export async function retractByRef(
  userId: string | Types.ObjectId,
  refId: string | Types.ObjectId,
  session?: ClientSession,
): Promise<number> {
  const result = await PersonalEventModel.deleteMany(
    { userId: new Types.ObjectId(userId), refId: new Types.ObjectId(refId) },
    { session },
  );
  return result.deletedCount ?? 0;
}

/**
 * Retract the one event a dedupe key names.
 *
 * For a fact that stops being true without its record going away: a habit stepped back
 * below its target is still logged, but it is no longer completed that day. `retractByRef`
 * would take every day's completion of the habit with it.
 */
export async function retractByDedupeKey(
  userId: string | Types.ObjectId,
  key: string,
  session?: ClientSession,
): Promise<number> {
  const result = await PersonalEventModel.deleteOne(
    { userId: new Types.ObjectId(userId), dedupeKey: key },
    { session },
  );
  return result.deletedCount ?? 0;
}

/**
 * The timeline as the CLIENT is promised it — `id`, not `_id`.
 *
 * `todayResponseSchema` in @synitheia/shared declares `id`, and that schema is the
 * contract both sides compile against. Returning raw lean documents leaks Mongo's
 * `_id` and silently breaks every consumer that keys a list on `event.id` — which is
 * not a type error, because the declared type says the field is there. The mapping
 * belongs here, at the boundary, rather than in each caller.
 */
export interface TimelineEvent extends Omit<PersonalEventDoc, 'userId'> {
  id: string;
  userId: string;
}

function toTimelineEvent(doc: PersonalEventDoc & { _id: Types.ObjectId }): TimelineEvent {
  const { _id, userId, refId, ...rest } = doc;
  return {
    ...rest,
    id: _id.toString(),
    userId: userId.toString(),
    refId: refId ?? null,
  } as TimelineEvent;
}

export async function timelineFor(
  userId: string | Types.ObjectId,
  localDate: string,
  limit = 100,
): Promise<TimelineEvent[]> {
  const docs = await PersonalEventModel.find({
    userId: new Types.ObjectId(userId),
    localDate,
  })
    .sort({ timestamp: 1 })
    .limit(limit)
    .lean<(PersonalEventDoc & { _id: Types.ObjectId })[]>();

  return docs.map(toTimelineEvent);
}

export async function eventsBetween(
  userId: string | Types.ObjectId,
  fromLocalDate: string,
  toLocalDate_: string,
  types?: readonly EventType[],
): Promise<PersonalEventDoc[]> {
  const query: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    localDate: { $gte: fromLocalDate, $lte: toLocalDate_ },
  };
  if (types?.length) query.type = { $in: types };

  return PersonalEventModel.find(query).sort({ timestamp: 1 }).lean<PersonalEventDoc[]>();
}
