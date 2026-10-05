# Filey Hermes pilot

This is an opt-in, **read-only cloud pilot**, behind Filey's existing agent
interface. Installing it does not change the default agent, enable a UI switch,
or upload local/BYOK conversations. The first release can inspect invoices,
customers, products and reports. It cannot create/issue documents, send messages,
make payments, run computer tools, or access arbitrary files. Those actions still
use Filey's existing permission/approval/idempotency workflow.

The actual upstream Hermes `AIAgent` is pinned to the commit and ZIP checksum in
`hermes/upstream.lock.json`. Source is prepared outside the checkout and verified
byte-for-byte before use. Dependencies are installed in a separate hash-locked
Python environment. The MIT license and attribution are preserved in
`hermes/LICENSE.hermes` and `hermes/NOTICE`. No upstream source patches are applied.

## Boundaries

- Browser requests use the signed-in user's JWT and selected `X-Filey-Org`.
  Supabase Auth, current profile and current membership are verified on admission
  and subsequent reads. Existing MFA requirements apply.
- The reviewed Filey MCP child retains the user JWT, RLS and live module gates.
  The Hermes process receives only a random capability for its own job's model
  and read-only MCP relay. It has no Supabase, provider or service-role key.
- Hermes has only the reviewed Filey MCP toolset. Memory, skills, terminal,
  browser, arbitrary Python execution, delegation, fallback and automatic model
  retries are disabled. Private reasoning and tool traces are not sent to users.
- Model requests go through the existing `ai-credits` endpoint, fixed to Filey AI
  and the job's reasoning toggle. Coin pricing/reservation/settlement remain in
  the existing backend. Each completion has one receipt; an ambiguous response
  permits status checks only. No second provider call or default-agent fallback.
- Job admission is durable and UUID-idempotent. Events have sequence numbers.
  Disconnecting a browser does not stop server execution. Reload recovery uses
  the saved scoped job pointer, then GET only. Explicit Stop requests cancellation;
  already performed model work can still use Coin.
- The SQLite journal encrypts prompts/replies/events with AES-GCM bound to the
  account and workspace. Fingerprints use a derived HMAC key. JWTs, capabilities
  and provider credentials are never stored in it. Terminal jobs expire after
  24 hours. Keep its directory and independent 32-byte key private, back them up
  together, and never rotate/delete the key without a migration plan.
- Restarted queued/running jobs become interrupted, never replayed. The pilot is
  bounded to two global concurrent jobs, one per account, 12 model calls and a
  five-minute service deadline (the Hermes worker is more tightly bounded).

## Local development

Requires Node 22.13+ and the pinned isolated Python interpreter. The local
runner is explicitly development-only and the listener is loopback-only. Use
fictional test data; production data belongs in the sandboxed deployment.

1. `npm ci --prefix mcp-server` then `npm run build --prefix mcp-server`.
2. Run `hermes/bootstrap.py --cache <private-directory-outside-checkout>` with an
   approved `uv` executable. It prints the prepared source and venv interpreter.
3. Configure process environment (never a committed file): `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `FILEY_HERMES_DATA_KEY` (32 random bytes, base64),
   `FILEY_HERMES_DEV_LOCAL=1`, `FILEY_HERMES_PYTHON`,
   `FILEY_HERMES_SOURCE_DIR`, and the exact comma-separated
   `FILEY_HERMES_ALLOWED_ORIGINS`. The port defaults to 16472.
4. `node agent-runtime/service/server.mjs`.
5. Set `VITE_FILEY_HERMES_PILOT_URL=http://127.0.0.1:16472` in a development
   build. The caller must also explicitly choose `runtime: 'hermes'`; otherwise
   it continues using the current Filey harness. There is no production UI switch.

## Production gate

Do not turn this pilot on for users until the separate runtime infrastructure
has passed an end-to-end deployment review. It is not a Vercel static route or
a Supabase request-scoped function. It requires a persistent Node process, an
encrypted persistent volume, the existing deployed Coin backend, a TLS reverse
proxy, and a Docker host controlled by the operator.

Build `docker build --tag filey-hermes-pilot agent-runtime/hermes`, audit the image,
and configure its exact `sha256:...` image ID as `FILEY_HERMES_IMAGE_DIGEST`.
`NODE_ENV=production` forbids the local runner. Nonlocal mode requires
`FILEY_HERMES_BIND_ADDRESS=0.0.0.0`: put that listener on a **private, firewalled
host interface**, expose only `/v1/jobs` through the authenticated HTTPS reverse
proxy, and never expose `/internal/` publicly. The browser receives only the
trusted HTTPS build URL, never an internal capability.

For every worker the service creates and verifies a separate Docker `--internal`
bridge network. The worker has no Internet route or shared tenant network and
uses only that bridge's private host gateway for its scoped relays. It runs as
UID 10001, with a read-only filesystem, dropped capabilities, no new privileges,
bounded memory/CPU/PIDs and an ephemeral `/tmp`. The Docker socket and host files
are never mounted into it. Validate the host firewall, relay reachability,
Internet-egress denial, cancellation/cleanup and concurrent tenant isolation on
the actual deployment host before enabling the flag. Do not give an untrusted
container the user's login JWT or a service-role key as a workaround.

## API and verification

`POST /v1/jobs`: `{request_id: UUID, messages: [{role:'user'|'assistant',text}],
reasoning:boolean}`. The last message must be a user request. Only text is
supported; 30 messages, 16,000 characters per message and 64,000 UTF-8 request
bytes are the limits. The job ID equals the request UUID.

`GET /v1/jobs/:id` returns the saved status/result.
`GET /v1/jobs/:id/events?after=N` returns up to 128 ordered events plus
`last_sequence`; drain all pages before treating a terminal result as complete.
`POST /v1/jobs/:id/cancel` stops further work. All public calls require the
current authenticated JWT and original workspace. Missing, stale, unauthorized
and uncertain jobs never authorize a fresh submission with another UUID.

Checks: `npm run test:hermes`, `npm run smoke:pilot --prefix mcp-server`,
the frontend `hermes-agent` tests, and `hermes/tests/test_runner.py`. The real-core
smoke uses a fake model and fake read-only MCP fixture; it does not charge Coin,
contact customer data, or prove production deployment/billing is ready.
