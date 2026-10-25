import { describe, expect, it, vi } from 'vitest';
import { mailerFor } from './resend.js';

describe('mailerFor', () => {
  it('is off until both the key and the sender are set', () => {
    expect(mailerFor({ RESEND_API_KEY: undefined, MAIL_FROM: 'Synítheia <hello@example.com>' })).toBeNull();
    expect(mailerFor({ RESEND_API_KEY: 're_test', MAIL_FROM: undefined })).toBeNull();
  });

  it('sends through Resend, as the configured sender', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"id":"m1"}', { status: 200 }));
    const send = mailerFor(
      { RESEND_API_KEY: 're_test', MAIL_FROM: 'Synítheia <hello@example.com>' },
      fetchImpl,
    )!;

    await send({ to: 'reader@example.com', subject: 'Subject', text: 'Body' });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer re_test');
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'Synítheia <hello@example.com>',
      to: ['reader@example.com'],
      subject: 'Subject',
      text: 'Body',
    });
  });

  it('fails loudly when Resend refuses the message', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"message":"domain not verified"}', { status: 403 }));
    const send = mailerFor({ RESEND_API_KEY: 're_test', MAIL_FROM: 'a@example.com' }, fetchImpl)!;

    await expect(send({ to: 'reader@example.com', subject: 'S', text: 'T' })).rejects.toThrow(/403/);
  });
});
