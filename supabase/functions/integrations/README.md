# `integrations` — Composio + Zernio on Filey's keys

Why this exists: a platform API key cannot ship inside the desktop app. The
binary is on the customer's machine, so anything compiled into it can be read
back out, and then it is Filey's Composio bill and Filey's Zernio credits being
spent by whoever extracted it — with no way to revoke one customer. The key
lives here instead, as a Supabase secret, and the app calls this function with
the user's own session.

## Deploy

Both keys are already in `.env.local` at the repo root (gitignored). With a
current Supabase personal access token:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...           # supabase.com/dashboard/account/tokens
npx supabase@latest link --project-ref voyrjqgaypiylwskkwpr

# Secrets — read from .env.local so the values never land in shell history
npx supabase@latest secrets set \
  COMPOSIO_API_KEY="$(grep '^COMPOSIO_API_KEY=' .env.local | cut -d= -f2-)" \
  ZERNIO_API_KEY="$(grep '^ZERNIO_API_KEY=' .env.local | cut -d= -f2-)"

npx supabase@latest functions deploy integrations
```

`verify_jwt` stays on (the default): the function trusts the `sub` claim for
identity and rate limiting, which only holds if the platform verified the token.

## What it does

| provider | actions |
|---|---|
| `composio` | `list`, `status`, `connect`, `execute`, `tools` |
| `zernio` | `accounts`, `profiles`, `posts`, `usage`, `create_post`, `delete_post` |

Billable actions (`composio_execute`, `composio_connect`, `zernio_create_post`,
`zernio_delete_post`) are counted in `audit_log` under `integration_action` and
capped daily per user: 25 on the free tier, 2000 on a paid plan. Reads are free.

Composio calls pass the caller's Supabase user id as the entity, so one platform
key serves every customer and no one can reach another's connected accounts.

## Bring-your-own-key

Unaffected. A customer with their own key in Settings → Integrations calls the
provider directly (Composio through the Rust encrypted store, Zernio from device
storage) and is never metered here — that path is for offline installs and
self-hosters.
