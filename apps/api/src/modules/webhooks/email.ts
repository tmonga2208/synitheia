import { UserModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import { tokenFromAddress } from '../expenses/inbox.js';
import { ingestEmail, ingestPdf, recordLockedStatement } from '../expenses/ingestion.js';
import type { Env } from '../../config/env.js';
import type { AuthedUser } from '../../core/auth-guard.js';

export interface InboundEmailPayload {
  to?: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  attachments?: { filename?: string; contentType?: string; contentBase64?: string }[];
}

export interface NormalizedEmail {
  to: string;
  from: string | null;
  subject: string | null;
  text: string;
  messageId: string | null;
  pdfAttachments: { filename: string; buffer: Buffer }[];
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseInboundPayload(body: InboundEmailPayload): NormalizedEmail {
  const text =
    body.text && body.text.trim() ? body.text.trim() : body.html ? htmlToText(body.html) : '';

  const pdfAttachments = (body.attachments ?? [])
    .filter(
      (a) =>
        (a.contentType ?? '').toLowerCase().includes('pdf') ||
        (a.filename ?? '').toLowerCase().endsWith('.pdf'),
    )
    .filter((a): a is { filename?: string; contentType?: string; contentBase64: string } =>
      Boolean(a.contentBase64),
    )
    .map((a) => ({
      filename: a.filename ?? 'statement.pdf',
      buffer: Buffer.from(a.contentBase64, 'base64'),
    }));

  return {
    to: body.to ?? '',
    from: body.from ?? null,
    subject: body.subject ?? null,
    text,
    messageId: body.messageId ?? null,
    pdfAttachments,
  };
}

/** Fire-and-forget from the route: every error mode here resolves quietly (no data leak). */
export async function handleInboundEmail(env: Env, body: InboundEmailPayload): Promise<void> {
  if (!env.INBOUND_DOMAIN) return;

  const mail = parseInboundPayload(body);

  const token = tokenFromAddress(mail.to, env.INBOUND_DOMAIN);
  if (!token) return; // recipient is not one of our inbox addresses

  const userDoc = await UserModel.findOne({ inboundToken: token })
    .select('+inboundToken timezone currency')
    .lean();
  if (!userDoc) return; // unknown token → drop, no enumeration signal

  const user: AuthedUser = {
    id: userDoc._id.toString(),
    timezone: userDoc.timezone,
    currency: userDoc.currency,
  };
  const source = { from: mail.from, subject: mail.subject, receivedAt: new Date() };

  // Body (the real-time alert case).
  if (mail.text) {
    try {
      await ingestEmail(env, user, {
        messageId: mail.messageId,
        from: mail.from,
        subject: mail.subject,
        text: mail.text,
      });
    } catch (err) {
      // A forwarded promo email with no transaction is normal, not an error.
      if (!(err instanceof AppError && err.code === 'ingestion_failed')) throw err;
    }
  }

  // PDF attachments (monthly e-statements).
  for (const pdf of mail.pdfAttachments) {
    try {
      await ingestPdf(env, user, pdf.buffer, undefined, {
        channel: 'email',
        messageId: mail.messageId,
        source,
      });
    } catch (err) {
      if (err instanceof AppError && err.code === 'pdf_password_required') {
        await recordLockedStatement(user, source, mail.messageId);
        continue;
      }
      if (err instanceof AppError && err.code === 'ingestion_failed') continue;
      throw err;
    }
  }
}
