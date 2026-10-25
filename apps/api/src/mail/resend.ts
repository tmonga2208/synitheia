/**
 * Outgoing email, through Resend's HTTP API.
 *
 * Plain `fetch`, not an SDK: one endpoint, one request shape, no new dependency. Off (null)
 * until both RESEND_API_KEY and MAIL_FROM are set, so a server without them simply has no
 * email features; nothing breaks. MAIL_FROM must be on a domain verified in Resend.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type SendMail = (mail: Mail) => Promise<void>;

const RESEND_URL = 'https://api.resend.com/emails';

export function mailerFor(
  env: { RESEND_API_KEY?: string; MAIL_FROM?: string },
  fetchImpl: typeof fetch = fetch,
): SendMail | null {
  const { RESEND_API_KEY: key, MAIL_FROM: from } = env;
  if (!key || !from) return null;

  return async (mail) => {
    const res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
    });

    if (!res.ok) {
      throw new Error(`Resend refused the message (${res.status}): ${await res.text().catch(() => '')}`);
    }
  };
}
