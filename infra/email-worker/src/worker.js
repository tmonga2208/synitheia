import PostalMime from 'postal-mime';

/**
 * Cloudflare Email Worker. Bound to Email Routing on inbox-*@in.<domain>, it parses each
 * forwarded message and POSTs it to the API webhook as JSON. It stores nothing.
 */
export default {
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw);

    const attachments = (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? 'attachment',
      contentType: a.mimeType ?? 'application/octet-stream',
      contentBase64: bytesToBase64(a.content),
    }));

    const payload = {
      to: message.to, // envelope recipient — the inbox-<token>@... address
      from: parsed.from?.address ?? message.from ?? null,
      subject: parsed.subject ?? null,
      text: parsed.text ?? '',
      html: parsed.html ?? '',
      messageId: parsed.messageId ?? null,
      attachments,
    };

    const res = await fetch(`${env.API_URL}/v1/webhooks/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.WEBHOOK_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    // A 5xx means our API is down; let Email Routing retry by throwing.
    if (res.status >= 500) throw new Error(`webhook ${res.status}`);
  },
};

function bytesToBase64(content) {
  // postal-mime gives an ArrayBuffer/Uint8Array; Workers have btoa but not Buffer by default.
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
