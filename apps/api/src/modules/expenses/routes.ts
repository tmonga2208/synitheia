import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  clientIdSchema,
  createExpenseSchema,
  localDateSchema,
  objectIdSchema,
  updateExpenseSchema,
  type LocalDate,
} from '@synitheia/shared';
import { AppError } from '../../core/errors.js';
import { loadEnv } from '../../config/env.js';
import * as service from './service.js';
import * as ingestion from './ingestion.js';
import * as receipts from './receipts.js';
import * as inbox_service from './inbox.js';

export async function registerExpenseRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const env = loadEnv();

  api.get(
    '/expenses',
    {
      onRequest: [app.requireAuth],
      schema: {
        querystring: z.object({
          from: localDateSchema.optional(),
          to: localDateSchema.optional(),
          categoryId: objectIdSchema.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const items = await service.listExpenses(req.user, {
        from: req.query.from as LocalDate | undefined,
        to: req.query.to as LocalDate | undefined,
        categoryId: req.query.categoryId,
        limit: req.query.limit,
      });
      return { items };
    },
  );

  api.post(
    '/expenses',
    {
      onRequest: [app.requireAuth],
      schema: { body: createExpenseSchema.and(clientIdSchema) },
    },
    async (req, reply) => {
      const expense = await service.createExpense(req.user, req.body);
      return reply.status(201).send({ expense });
    },
  );

  api.patch(
    '/expenses/:id',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: updateExpenseSchema,
      },
    },
    async (req) => {
      const expense = await service.updateExpense(req.user, req.params.id, req.body);
      return { expense };
    },
  );

  api.delete(
    '/expenses/:id',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req, reply) => {
      await service.deleteExpense(req.user, req.params.id);
      return reply.status(204).send();
    },
  );

  api.get(
    '/expenses/totals',
    {
      onRequest: [app.requireAuth],
      schema: {
        querystring: z.object({ from: localDateSchema, to: localDateSchema }),
      },
    },
    async (req) =>
      service.totalsFor(req.user, req.query.from as LocalDate, req.query.to as LocalDate),
  );

  // ─── Categories ───────────────────────────────────────────────────────────

  api.get('/expense-categories', { onRequest: [app.requireAuth] }, async (req) => ({
    items: await service.listCategories(req.user.id),
  }));

  api.post(
    '/expense-categories',
    {
      onRequest: [app.requireAuth],
      schema: {
        body: z.object({
          name: z.string().min(1).max(40),
          icon: z.string().min(1),
          color: z.string().regex(/^#[0-9a-f]{6}$/i),
        }),
      },
    },
    async (req, reply) => {
      const category = await service.createCategory(req.user.id, req.body);
      return reply.status(201).send({ category });
    },
  );

  api.patch(
    '/expense-categories/:id',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: z.object({
          name: z.string().min(1).max(40).optional(),
          icon: z.string().min(1).optional(),
          color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
        }),
      },
    },
    async (req) => ({
      category: await service.renameCategory(req.user.id, req.params.id, req.body),
    }),
  );

  // ─── Ingestion ────────────────────────────────────────────────────────────
  //
  // Every channel returns DRAFTS. Nothing here writes an expense — that happens only
  // when the user confirms, via POST /expenses with the ingestionId attached.

  api.post(
    '/expenses/ingest/text',
    {
      onRequest: [app.requireAuth],
      schema: { body: z.object({ text: z.string().min(1).max(8000) }) },
    },
    async (req, reply) => {
      const result = await ingestion.ingestText(env, req.user, req.body.text);
      return reply.status(201).send({ ingestion: result });
    },
  );

  api.post(
    '/expenses/ingest/file',
    { onRequest: [app.requireAuth] },
    async (req, reply) => {
      const file = await req.file();
      if (!file) throw AppError.badRequest('No file was uploaded');

      const buffer = await file.toBuffer();
      const mime = file.mimetype;

      /**
       * The open password for a locked bank statement, when the user has typed one.
       *
       * It travels in the multipart body rather than the query string precisely because
       * query strings end up in access logs and proxy metrics. This value is used to open
       * the document and is then dropped — it is never logged, and never persisted.
       */
      const passwordField = file.fields.password;
      const password =
        passwordField && !Array.isArray(passwordField) && passwordField.type === 'field'
          ? String(passwordField.value)
          : undefined;

      const result = mime.startsWith('image/')
        ? await ingestion.ingestScreenshot(env, req.user, {
            base64: buffer.toString('base64'),
            mediaType: mime,
          })
        : mime === 'application/pdf'
          ? await ingestion.ingestPdf(env, req.user, buffer, password)
          : mime === 'text/csv' || file.filename.toLowerCase().endsWith('.csv')
            ? await ingestion.ingestCsv(req.user, buffer.toString('utf8'))
            : null;

      if (!result) {
        throw AppError.badRequest(
          `Unsupported file type "${mime}". Share a screenshot, a PDF statement, or a CSV.`,
        );
      }

      return reply.status(201).send({ ingestion: result });
    },
  );

  api.get('/expenses/ingestions', { onRequest: [app.requireAuth] }, async (req) => ({
    items: await ingestion.listPendingIngestions(req.user.id),
  }));

  // ─── Statement inbox ──────────────────────────────────────────────────────

  api.post('/expenses/inbox', { onRequest: [app.requireAuth] }, async (req, reply) => {
    const inbox = await inbox_service.getOrCreateInbox(env, req.user.id);
    return reply.status(201).send({ inbox });
  });

  api.get('/expenses/inbox', { onRequest: [app.requireAuth] }, async (req) => ({
    inbox: await inbox_service.getInbox(env, req.user.id),
  }));

  api.get(
    '/expenses/ingestions/:id',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req) => ({
      ingestion: await ingestion.getIngestion(req.user.id, req.params.id),
    }),
  );

  api.post(
    '/expenses/ingestions/:id/reject',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req, reply) => {
      await ingestion.rejectIngestion(req.user.id, req.params.id);
      return reply.status(204).send();
    },
  );

  /**
   * Confirm some or all drafts from an ingestion. This is the ONLY path from a parsed
   * artifact to a real Expense, and it requires an explicit per-draft decision from
   * the user — Detect → Infer → Suggest → Confirm.
   */
  api.post(
    '/expenses/ingestions/:id/confirm',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: z.object({
          confirmations: z
            .array(
              z.object({
                draftIndex: z.number().int().nonnegative(),
                categoryId: objectIdSchema,
                /** The user may correct what we read before accepting it. */
                amountMinor: z.number().int().positive().optional(),
                merchant: z.string().max(120).nullish(),
                occurredAt: z.coerce.date().optional(),
              }),
            )
            .min(1),
        }),
      },
    },
    async (req, reply) => {
      const record = await ingestion.getIngestion(req.user.id, req.params.id);
      const drafts = record.drafts as unknown as {
        amountMinor: number;
        merchant: string | null;
        occurredAt: Date | null;
      }[];

      const created = [];
      for (const c of req.body.confirmations) {
        const draft = drafts[c.draftIndex];
        if (!draft) {
          throw AppError.badRequest(`No draft at index ${c.draftIndex}`);
        }

        created.push(
          await service.createExpense(req.user, {
            amountMinor: c.amountMinor ?? draft.amountMinor,
            categoryId: c.categoryId,
            merchant: c.merchant !== undefined ? c.merchant : draft.merchant,
            note: null,
            // A statement with no date is filed as of now, not as of the epoch.
            occurredAt: c.occurredAt ?? draft.occurredAt ?? new Date(),
            ingestionId: req.params.id,
          }),
        );
      }

      await ingestion.markIngestionConfirmed(req.user.id, req.params.id);
      return reply.status(201).send({ expenses: created });
    },
  );

  // ─── Splitting ────────────────────────────────────────────────────────────

  api.get('/expenses/owed', { onRequest: [app.requireAuth] }, async (req) => {
    const items = await service.listOwed(req.user);
    return {
      items,
      totalMinor: items.reduce((acc, i) => acc + i.shareMinor, 0),
    };
  });

  api.post(
    '/expenses/:id/settle',
    {
      onRequest: [app.requireAuth],
      schema: {
        params: z.object({ id: objectIdSchema }),
        body: z.object({
          index: z.number().int().nonnegative(),
          /** False un-settles — people do say "actually I never paid you". */
          settled: z.boolean().default(true),
        }),
      },
    },
    async (req) => ({
      expense: await service.settleParticipant(
        req.user,
        req.params.id,
        req.body.index,
        req.body.settled,
      ),
    }),
  );

  // ─── One expense, in full ─────────────────────────────────────────────────

  /**
   * Everything about a single expense: what it was, who owes what, whether a receipt is
   * attached, and where the row came from. The list deliberately carries none of this —
   * it renders hundreds of rows and must not drag participants and receipts through every
   * one of them.
   */
  api.get(
    '/expenses/:id',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req) => ({
      expense: await service.getExpense(req.user, req.params.id),
      receiptsAllowed: await receipts.receiptsAllowed(req.user.id),
    }),
  );

  // ─── Receipts ─────────────────────────────────────────────────────────────
  //
  // Gated on the user's explicit consent, enforced HERE and not only in the app. A client
  // that forgot to ask cannot write an image to the database anyway.

  api.post(
    '/expenses/:id/receipt',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req, reply) => {
      const file = await req.file();
      if (!file) throw AppError.badRequest('No image was uploaded');

      const result = await receipts.attachReceipt(env, req.user, req.params.id, {
        buffer: await file.toBuffer(),
        contentType: file.mimetype,
      });

      return reply.status(201).send(result);
    },
  );

  api.get(
    '/expenses/:id/receipt',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    /**
     * Returns a short-lived SIGNED URL rather than the bytes.
     *
     * The image is a private file in ImageKit and cannot be fetched without a signature —
     * so a link that leaks into a log or a share sheet expires instead of becoming a
     * permanent window into someone's spending. Streaming the bytes through this API would
     * put every receipt on our bandwidth for no benefit.
     */
    async (req) => receipts.receiptLink(env, req.user.id, req.params.id),
  );

  api.delete(
    '/expenses/:id/receipt',
    {
      onRequest: [app.requireAuth],
      schema: { params: z.object({ id: objectIdSchema }) },
    },
    async (req, reply) => {
      await receipts.deleteReceipt(env, req.user.id, req.params.id);
      return reply.status(204).send();
    },
  );
}
