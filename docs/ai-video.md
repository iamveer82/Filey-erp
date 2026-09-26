# Filey brand videos

New image/video requests default to the customer's own keys. See
[Images and videos in chat](ai-media.md). This document covers the optional
managed-credit video backend, which has no configured Higgsfield credentials.

Filey AI → **Brand videos** opens an inline panel. Customers can describe a film,
attach one product photo, choose portrait/landscape/square, set 4–15 seconds,
and enable generated audio. The initial preset is **Higgsfield Seedance 2.0 at
720p**. Photo-based videos follow the photo's framing.

The price is **$0.25 USD per selected second**: 4 seconds costs $1.00, 5 costs
$1.25, 10 costs $2.50 and 15 costs $3.75. A quote is free and expires in ten
minutes. The server checks Higgsfield's authenticated estimate and declines a
quote if the provider estimate exceeds Filey's fixed price. This is a video
rate, separate from chat token pricing and the $0.50 credit top-up service fee.

## Wallet and lifecycle

- All plans use the same personal AI credit wallet; no subscription upgrade is
  required. Local-mode users sign into their cloud account for hosted video
  generation. This does not switch storage mode or upload ERP records.
- The agent can prepare a quote, list/check videos and cancel a queued video.
  Only the customer's **Generate · $amount** click submits paid generation.
  The AI is instructed not to use browser/computer tools to bypass this decision.
- The exact quote is reserved atomically before submission. Existing per-task
  and daily limits apply. The default $1 task limit covers a four-second clip;
  longer clips require the customer to raise that limit. Filey never raises it
  automatically. Up to three unexpired videos may run concurrently.
- Repeated Generate requests return the same job. Network loss after submission
  is **uncertain**, never an automatic resubmission. A provider callback can
  recover the provider request ID when the submission response was lost.
- Verified success charges the fixed quote once. Failed, moderated and verified
  canceled jobs release the hold. Cancellation is possible only before provider
  processing starts. Stopping chat does not cancel a video.
- Video holds last at most 24 hours; ordinary chat holds remain ten minutes.
  The wallet releases expired holds on its next read/mutation. Late completion
  cannot charge released money; Filey absorbs that provider cost. Reopening a
  stale job reconciles its result or marks it failed without a charge.
- Jobs persist independently of chat. The panel prioritizes running jobs within
  the latest 30 results. Chat history persists job IDs across restart and keeps
  generated artifacts even if a later model request fails or the user stops.

## Storage and load

Supabase stores job metadata and the wallet ledger, **not video bytes**. Prompts
and an optional reference image are sent to Higgsfield. Reference images are
validated JPG/PNG/WebP under 2 MB, uploaded to a provider-signed temporary URL
without forwarding the merchant authorization header.

Verified provider callbacks settle jobs while Filey is closed. Visible running
cards poll every 30 seconds as a fallback; hidden pages do not poll, finished
jobs stop polling, and the server coalesces status checks within 15 seconds.
Unchanged provider states do not trigger a second database write.

The completed video plays inline. **Open MP4** opens the file in the system
browser for download; it does not pretend to have saved a local file. Higgsfield
guarantees output retention for at least seven days, so customers should download
files for long-term retention. Automatic cloud media archival and social posting
are not part of this workflow.

## Deployment

1. Apply the existing AI credit migrations, then
   `supabase/2026-09-21-ai-video.sql`. It creates an account-owned job table,
   service-only transition RPC, reservation expiry column and index. It changes
   no ERP business tables or local schema.
2. Store a valid, funded API pair as **HF_API_KEY_ID** and **HF_API_KEY_SECRET** in
   Supabase Edge Function secrets. Never put either value in VITE variables,
   source files, logs or client settings. Higgsfield API billing is separate from
   its consumer website subscription.
3. Deploy `ai-video`, `ai-credits` and `dodo` with `--no-verify-jwt`. User actions
   verify their JWT through `auth.getUser`; quote/start require a verified email.
   Video-only wallets can buy credit packs without an OpenRouter key.
4. No dashboard webhook setup is needed: each generation carries its own
   `hf_webhook` URL. The callback uses an opaque 256-bit per-job token, stored in
   the service-only job table, then independently fetches the provider's current
   status. Incoming webhook status, price and output URLs are never authority
   for settlement. Job responses exclude callback tokens and provider internals.
5. Publish/configure the Dodo credit products as described in `ai-credits.md`,
   verify a funded estimate, then perform one explicitly authorized paid smoke
   test before enabling customer sales. Rebuild desktop to include its HTTPS
   media CSP, and release the normal web/desktop builds.

Validation uses mocked provider requests and disposable PostgreSQL: exact price,
simultaneous clicks, forged quotes/callbacks, owner isolation, loss of submission
response, duplicate completion, cancellation, stale holds and late success.
No customer records or real paid generations are used in those tests.

Current activation blocker: on September 21, 2026 the supplied Higgsfield pair
returned **401 Invalid credentials** on the official estimate endpoint. It was
not stored in Supabase or committed. Live generation still needs a valid pair
and a funded API account; local fixtures do not prove provider availability.

The migration and `ai-video`, `ai-credits`, and `dodo` handlers are deployed.
Schema read-back verified RLS, private callback data and service-only transition
permissions. Unauthenticated requests return 401 and malformed callbacks return
403. The frontend remains on the development branch pending the normal release.
Validation: 1,639 app tests, 84 edge tests, build, lint (no errors), disposable
PostgreSQL concurrency/isolation checks and a 390px fixture workflow.

Official references: [request lifecycle](https://docs.higgsfield.ai/docs/concepts/requests),
[billing and retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention),
[webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks).
