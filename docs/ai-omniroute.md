# Filey AI through OmniRoute

This is an optional, server-only route for paid Filey AI usage. Customers use
Filey AI and spend **Paper**, where **1 Paper = US$1 of spendable AI credit**.
Customers choose a named paid model from the live OpenRouter catalogue. All
compatible models are available by default; operators can restrict the list
through `FILEY_AI_MODELS`. Filey sends the customer's concrete model ID and
does not substitute another model. Chat usage has no markup. The existing **US$0.50 service fee**
applies once when adding credit, separately from the spendable balance.

Direct OpenRouter remains the default and recommended route. This optional
gateway is not required for model selection, Paper billing or checkout.

Free AI continues directly through OpenRouter, with its existing account and
provider quotas, without requiring or debiting a wallet. BYOK remains separate.
OmniRoute does not provide free access to paid models or remove provider charges.
See [wallet, checkout and ledger setup](ai-credits.md).

## What is implemented and what is not live

The Filey gateway adapter and receipt verification are implemented in the source.
This document is a deployment procedure, not evidence of a running service.
Activation still needs a gateway host, server secrets, provider configuration,
deployment and end-to-end verification. No paid transaction or production
customer record was changed for this integration. Validate checkout in Dodo test
mode before enabling it for customers.

## Reviewed upstream version

The reviewed upstream is commit
[`7d23bcf8ecb3b43c00c024e317af9c39384a1bee`](https://github.com/diegosouzapw/OmniRoute/tree/7d23bcf8ecb3b43c00c024e317af9c39384a1bee),
whose package version is `3.8.51`. Pin the commit; do not assume a `v3.8.51` tag
exists or deploy a moving branch or `latest` package without rechecking behavior.
The [MIT license](https://github.com/diegosouzapw/OmniRoute/blob/7d23bcf8ecb3b43c00c024e317af9c39384a1bee/LICENSE)
permits commercial use; preserve its notice if redistributing upstream code.

## Deploy without Docker

Use a persistent Node server with local durable storage, rather than a Supabase
Edge Function or an ephemeral web deployment. The reviewed
[package](https://github.com/diegosouzapw/OmniRoute/blob/7d23bcf8ecb3b43c00c024e317af9c39384a1bee/package.json)
supports Node `>=22.22.2 <23 || >=24.0.0 <27`; Node 24 is a suitable choice.

1. On the server, provision a dedicated unprivileged `omniroute` service account,
   a source directory `/opt/filey-omniroute`, and a private writable data directory
   `/var/lib/filey-omniroute`. Install the supported Node runtime and build tools.
   Build as the service account, not root:

   ```sh
   git clone https://github.com/diegosouzapw/OmniRoute.git /opt/filey-omniroute
   cd /opt/filey-omniroute
   git checkout --detach 7d23bcf8ecb3b43c00c024e317af9c39384a1bee
   OMNIROUTE_SKIP_POSTINSTALL=1 npm ci
   npm run build
   ```

2. Create `/etc/filey-omniroute.env` outside either codebase. Restrict it to root
   and the service account. Put real values only in this private file or the
   host's secret manager. Generate independent random values for `JWT_SECRET`,
   `API_KEY_SECRET`, `STORAGE_ENCRYPTION_KEY`, `MACHINE_ID_SALT`, and
   `OMNIROUTE_WS_BRIDGE_SECRET`, and a strong `INITIAL_PASSWORD`. Retain the
   encryption keys securely across restarts and backups. Set:

   ```dotenv
   NODE_ENV=production
   HOST=127.0.0.1
   OMNIROUTE_SERVER_HOST=127.0.0.1
   PORT=20128
   DATA_DIR=/var/lib/filey-omniroute
   REQUIRE_API_KEY=true
   AUTH_COOKIE_SECURE=true
   STORAGE_ENCRYPTION_KEY_VERSION=v1
   BASE_URL=http://127.0.0.1:20128
   NEXT_PUBLIC_BASE_URL=https://gateway.example
   ```

   `gateway.example` is a placeholder for an operator-controlled hostname.
   `HOST` is used by the source
   [production launcher](https://github.com/diegosouzapw/OmniRoute/blob/7d23bcf8ecb3b43c00c024e317af9c39384a1bee/scripts/dev/run-next.mjs);
   `OMNIROUTE_SERVER_HOST` also protects a later switch to the standalone CLI.
   Upstream defaults allow unauthenticated inference and bind all interfaces, so
   both restrictions must be explicit. See the
   [environment reference](https://github.com/diegosouzapw/OmniRoute/blob/7d23bcf8ecb3b43c00c024e317af9c39384a1bee/.env.example)
   and [binding policy](https://github.com/diegosouzapw/OmniRoute/blob/7d23bcf8ecb3b43c00c024e317af9c39384a1bee/bin/cli/utils/serverHost.mjs).

3. Run the production launcher under the host's service manager. For a Linux
   systemd host, create `/etc/systemd/system/filey-omniroute.service`:

   ```ini
   [Unit]
   Description=Filey AI gateway
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   User=omniroute
   Group=omniroute
   WorkingDirectory=/opt/filey-omniroute
   EnvironmentFile=/etc/filey-omniroute.env
   ExecStart=/usr/bin/node scripts/dev/run-next.mjs start
   Restart=on-failure
   RestartSec=5
   UMask=0077
   NoNewPrivileges=true
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```

   Confirm `/usr/bin/node` is the installed supported runtime, then enable the
   service with `systemctl daemon-reload` and
   `systemctl enable --now filey-omniroute`. Keep the data directory backed up
   with its encryption keys; protect backups as credentials.

4. Terminate HTTPS at a reverse proxy on `gateway.example`, forwarding inference
   paths under `/v1/` to `http://127.0.0.1:20128/v1/`. Preserve the path and
   `Authorization` header, disable response buffering, and allow a sufficient
   completion timeout. Do not expose port 20128 publicly. Keep `/dashboard`,
   management `/api/` routes and login behind a separate private HTTPS admin
   path or network. The public inference origin must not expose provider setup,
   keys, logs or management tokens. Verify an unauthenticated inference request
   is rejected before configuring Filey.

## Configure one funded OpenRouter connection

Using the private gateway administration interface:

- Connect **one OpenRouter API-key account**, using the same funded key that
  Filey uses for server-side receipt verification. Do not add personal paid
  OAuth subscriptions, cookie sessions, shared personal-account pools or
  unrelated providers to this billing route. Provider permissions and terms
  still apply independently of OmniRoute's MIT license.
- Create a dedicated inference-only API key for Filey. Restrict
  `allowedConnections` to that connector and `allowedModels` to the concrete
  `openrouter/<model-id>` routes Filey permits. Explicitly deny combos and set
  `allowAutoCombos=false`, `cacheDefaultMode=bypass`,
  `compressionEnabled=false`, `noLog=true` and `autoResolve=false`. Do not grant
  management/admin scopes. The supported policy fields are defined in
  [API key storage](https://github.com/diegosouzapw/OmniRoute/blob/7d23bcf8ecb3b43c00c024e317af9c39384a1bee/src/lib/db/apiKeys.ts).
- Disable response/semantic caching, prompt compression, memory injection and
  gateway-owned agent/tool execution for this route. Filey's existing agent
  owns tool execution. Leave payload overrides, model aliases, OpenRouter
  connection presets and automatic model/combo substitutions unconfigured.
  Do not turn on request/response body logging.
- Preserve Filey's concrete model, tool definitions, output limit, provider
  price caps and `user` request marker. The
  [OpenRouter connector](https://github.com/diegosouzapw/OmniRoute/blob/7d23bcf8ecb3b43c00c024e317af9c39384a1bee/open-sse/config/providers/registry/openrouter/index.ts)
  uses the `openrouter/` prefix, not `or/`. Filey sends cache-bypass headers;
  the gateway must honor them for both reads and writes.

## Filey server configuration

Store these as Supabase Edge Function secrets, never `VITE_*` variables, frontend
settings or values in committed files:

| Secret | Value |
| --- | --- |
| `FILEY_AI_GATEWAY` | `omniroute` |
| `FILEY_AI_OMNIROUTE_URL` | `https://gateway.example/v1` using the real hostname |
| `FILEY_AI_OMNIROUTE_KEY` | Dedicated restricted gateway inference key |
| `FILEY_AI_OPENROUTER_KEY` | The same funded OpenRouter key used by the gateway connector |

Deploy the updated `ai-credits` function and frontend after gateway verification.
The gateway URL must be a public HTTPS `/v1` base with no query or fragment.
Clients cannot choose this URL or supply a merchant key. Partial or invalid
configuration fails closed rather than silently choosing another paid route.
Switching `FILEY_AI_GATEWAY` back to `openrouter` restores the existing direct
paid route; free AI already uses that direct route independently.

## Billing receipts and limits

OmniRoute's dashboard and response cost headers are estimates, not provider
bills. Its OpenAI response sanitizer removes `usage.cost`, but preserves the
OpenRouter generation ID. See
[cost tracking](https://github.com/diegosouzapw/OmniRoute/blob/7d23bcf8ecb3b43c00c024e317af9c39384a1bee/docs/guides/COST_TRACKING.md)
and the [response sanitizer](https://github.com/diegosouzapw/OmniRoute/blob/7d23bcf8ecb3b43c00c024e317af9c39384a1bee/open-sse/handlers/responseSanitizer.ts).

Filey reserves an allowance before inference, then independently reads
`GET https://openrouter.ai/api/v1/generation?id=<generation-id>` using its server
key. It requires the returned ID and model to match, `external_user` to equal
the validated Filey request ID, `is_byok=false`, and a finite nonnegative
`total_cost` within the accepted bound. An unverifiable receipt cannot debit
the wallet. See the [official generation API](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation).

Filey sends inference once. It may retry a **404 receipt read** up to three total
attempts because receipts can appear shortly after completion; it does not
retry inference to obtain a receipt. The gateway itself has internal retries
and recovery behavior, including model-family fallback. A universal upstream
no-retry switch has not been verified. Restricting the connector and validating
the receipt protects customer settlement, but unsuccessful or substituted
provider work may still cost Filey money. Never charge an estimate to recover it.

This first integration verifies **OpenRouter-backed usage only**. Do not enable
unrestricted `auto/cheap`, arbitrary provider pools, cached replies or a new
provider for paid Paper usage without a verifiable billing receipt and matching
spending controls. The top-up fee is revenue, not guaranteed profit: payment
processing, hosting, taxes and absorbed failures affect margin.

## Activation checks

Use a dedicated test account and synthetic prompts/documents; preserve customer
records. Confirm no-auth rejection, inference-key management rejection, exact
model selection, function tool-call continuity, output/price caps, cache bypass,
and verified request-bound receipts. Check missing receipts and substitutions
produce no wallet debit and release reservations. Confirm free AI stays free.
Check desktop and mobile wallet review show Paper, the USD equivalent and the
separate top-up fee, then complete Dodo **test-mode** checkout/webhook tests.
Do not label the gateway or payments live until these deployment checks pass.
