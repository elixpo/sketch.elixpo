# Pollinations BYOP image connector

LixSketch uses Pollinations' OAuth 2.1 authorization-code flow with PKCE. A
signed-in user authorizes a short-lived personal key, which is encrypted in D1
and used only by the server. The authorization request restricts that key to
the `flux` and `klein` image models and requests only `profile usage` account
access.

## Pollinations app setup

Create a publishable App Key (`pk_...`) at `https://enter.pollinations.ai/keys`
and register these redirect URIs:

```text
http://localhost:3000/api/integrations/pollinations/callback
https://sketch.elixpo.com/api/integrations/pollinations/callback
```

Keep developer earnings disabled unless the product intentionally adds the
provider's BYOP markup.

## Runtime secrets

```text
POLLINATIONS_APP_KEY=pk_...
POLLINATIONS_CONNECTION_ENCRYPTION_KEY=<long random secret>
POLLINATIONS_IMAGE_API=sk_...
```

- `POLLINATIONS_APP_KEY` identifies the OAuth app and is not a client secret.
- `POLLINATIONS_CONNECTION_ENCRYPTION_KEY` encrypts per-user `sk_` tokens at
  rest. Generate it independently from every other integration secret.
- `POLLINATIONS_IMAGE_API` remains the platform-managed fallback for guests,
  disconnected users, image edits, and users who disable personal Pollen.

Apply `worker/migrations/0008_pollinations_byop.sql` before deployment:

```bash
npm run db:migrate
```

Pollinations does not issue refresh tokens for BYOP. The connector requests a
30-day key; users reconnect after expiry. They can revoke the key immediately
from their Pollinations dashboard.
