import { z } from 'zod';
import { Types } from 'mongoose';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createReminderSchema,
  objectIdSchema,
  todayLocalDate,
  updateReminderSchema,
} from '@synitheia/shared';
import { AppError } from '../../core/errors.js';
import { ReminderModel, type ReminderDoc } from '../../db/models.js';
import { dedupeKey, emit } from '../../context/engine.js';

/**
 * Reminders are *definitions*, not deliveries.
 *
 * The server never pushes a reminder. Each device schedules them locally with
 * expo-notifications from the records below, which means they fire on a plane, in a
 * tunnel, and with the backend down — and no reminder is ever a round trip. These
 * routes exist so the definitions sync across a user's devices and survive a reinstall;
 * the firing itself is entirely on-device. The only thing the server hears about is
 * `/complete`, when the user acts on one.
 */

type ReminderWithId = ReminderDoc & { _id: Types.ObjectId };

export async function registerReminderRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get('/reminders', { onRequest: [app.requireAuth] }, async (req) => ({
    items: await ReminderModel.find({ userId: new Types.ObjectId(req.user.id) })
      .sort({ time: 1 })
      .lean<ReminderWithId[]>(),
  }));

  api.post(
    '/reminders',
    {
      onRequest: [app.requireAuth],
      schema: { body: createReminderSchema },
    },
    async (req, reply) => {
      const reminder = await ReminderModel.create({
        userId: new Types.ObjectId(req.user.id),
        kind: req.body.kind,
        refId: req.body.refId ? new Types.ObjectId(req.body.refId) : null,
        label: req.body.label,
        time: req.body.time,
        weekdays: req.body.weekdays,
        enabled: req.body.enabled,
      });

      return reply.status(201).send({ reminder });
    },
  );

  api.patch(
    '/reminders/:id',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: updateReminderSchema,
      },
    },
    async (req) => {
      const reminder = await ReminderModel.findOne({
        _id: new Types.ObjectId(req.params.id),
        userId: new Types.ObjectId(req.user.id),
      });

      if (!reminder) throw AppError.notFound('Reminder');

      if (req.body.kind !== undefined) reminder.kind = req.body.kind;
      if (req.body.refId !== undefined) {
        reminder.refId = req.body.refId ? new Types.ObjectId(req.body.refId) : null;
      }
      if (req.body.label !== undefined) reminder.label = req.body.label;
      if (req.body.time !== undefined) reminder.time = req.body.time;
      if (req.body.weekdays !== undefined) reminder.weekdays = req.body.weekdays;
      if (req.body.enabled !== undefined) reminder.enabled = req.body.enabled;

      await reminder.save();
      return { reminder };
    },
  );

  api.delete(
    '/reminders/:id',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req, reply) => {
      const result = await ReminderModel.deleteOne({
        _id: new Types.ObjectId(req.params.id),
        userId: new Types.ObjectId(req.user.id),
      });

      if (result.deletedCount === 0) throw AppError.notFound('Reminder');

      return reply.status(204).send();
    },
  );

  api.post(
    '/reminders/:id/complete',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req) => {
      const now = new Date();
      const localDate = todayLocalDate(req.user.timezone, now);

      const reminder = await ReminderModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(req.params.id),
          userId: new Types.ObjectId(req.user.id),
        },
        { $set: { lastFiredAt: now } },
        { new: true },
      );

      if (!reminder) throw AppError.notFound('Reminder');

      // Keyed on the local day, not the instant: a user who taps the notification and
      // then taps it again in the app has completed one reminder, not two, and the
      // timeline must show one row.
      await emit({
        userId: req.user.id,
        source: 'reminder',
        timestamp: now,
        timezone: req.user.timezone,
        refId: reminder._id,
        dedupeKey: dedupeKey(
          'reminder',
          'completed',
          `${reminder._id.toString()}:${localDate}`,
        ),
        metadata: {
          type: 'reminder.completed',
          reminderId: reminder._id.toString(),
          label: reminder.label,
        },
      });

      return { reminder };
    },
  );
}
