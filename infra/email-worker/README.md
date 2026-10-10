# Synítheia inbound email worker

Receives forwarded bank/UPI mail for `inbox-<token>@in.<domain>` and posts it to the API
webhook. Stores nothing.

## One-time setup
1. Add the domain to Cloudflare (keep registration at Vercel; point the domain's
   nameservers at Cloudflare — free). Vercel-hosted app records (A/CNAME/TXT) move to
   Cloudflare DNS.
2. Enable **Email → Email Routing** on the zone. Verify the MX records Cloudflare adds.
3. Add a **catch-all** (or `inbox-*`) route with action **Send to a Worker** → this worker.
4. Set secrets/vars:
   ```bash
   cd infra/email-worker && pnpm install
   npx wrangler secret put WEBHOOK_SECRET      # same value as the API's INBOUND_WEBHOOK_SECRET
   npx wrangler deploy --var API_URL:https://<your-api-host>
   ```
5. On the API, set `INBOUND_DOMAIN=in.<domain>` and `INBOUND_WEBHOOK_SECRET=<same secret>`.

## Test
Send an email to `inbox-<token>@in.<domain>` (get `<token>` from the app's inbox setup
screen). A transaction alert should appear in the app's review inbox within seconds.
