# Hosted channel agent validation

This batch hardens `supabase/functions/channel-webhook`. It does not deploy the function, modify production records, register provider webhooks, or send live messages.

## Fixed

- Provider message tracking fails closed before model or business work. Missing/unavailable dedup storage returns a retryable HTTP 503 instead of replaying writes.
- Public webhook bodies are limited to 256 KiB while streaming. Oversized bodies return 413.
- Channel credential lookup failures cannot fall back to possibly disconnected environment credentials. A cached credential remains valid for at most the existing 30-second window.
- Only a current workspace owner/admin can use the hosted service-role data tools. Ordinary user gateways must use the app's normal account/module/record permission checks.
- Invoice child queries pin `org_id` explicitly. A failed child query returns an error instead of inventing zero totals.
- Provider tool schemas are enforced in the dispatcher: object shape, required fields, nested line types/counts, finite numbers, dates, currencies and enum values. Model guidance alone is not a trust boundary.
- Invoice, quotation and purchase-order drafts save header, lines and audit entry in one PostgreSQL transaction. Quotation lines use the actual `product`/`rate` columns. Supplier linkage requires a unique exact name match.
- Approval codes are bound to their original channel and conversation and checked against the current workspace. Legacy unbound channel codes require a new proposal. The conditional claim checks owner, pending state and expiry again.
- Credential payloads are scrubbed atomically with the approval claim, including when subsequent provider work throws.
- The hosted status-only “mark paid” tool is removed. Legacy approvals cannot invent a payment without its amount, method and accounting entries; users record the payment in Filey.
- Model requests have a 30-second request timeout, a 90-second model-loop budget, six rounds and eighteen tool calls. Bounded results remain valid JSON and identify truncated previews. Failures tell users to inspect saved drafts before retrying.
- WhatsApp receipts/non-text callbacks and unknown senders no longer consume the owner's model quota. Logs retain only the current message ID as raw metadata instead of unrelated messages from a provider batch.

## Required migration

Apply `supabase/2026-09-30-channel-agent-drafts.sql` after the existing business/organization migrations and before deploying the hardened function. The function is additive, service-role only, accepts a constrained field allowlist, and asserts current profile/workspace/admin membership inside the transaction. Its definition is mirrored in `supabase/schema.sql`.

If this migration is absent, hosted draft tools return a simple failure without creating a partial draft. No migration was applied to production in this batch.

## Validation

- `deno test --allow-env --allow-read --deny-net --lock=deno.lock --frozen supabase/functions/channel-webhook`: **70 passed**.
- `deno check --lock=deno.lock --frozen supabase/functions/channel-webhook/index.ts`: passed.
- `node scripts/test-channel-agent-local.mjs`: passed against a disposable PostgreSQL 18 cluster, using synthetic tables/data. Checks cover anonymous/authenticated exclusion, service-role gate, cross-workspace denial, ordinary-member denial, real quotation column mapping, totals, rejected fields and rollback after a later line fails for all three document types. The migration is applied twice to check repeatability.

Logs: `output/channel-hardening-tests.log`, `output/channel-drafts-sql-tests.log`.

## Architecture boundaries

The hosted relay remains a single `OWNER_USER_ID` installation with its own cloud tool subset and an Anthropic server key. It is not a multi-customer hosted worker and cannot run the desktop PDF engine, desktop browser or arbitrary Filey tools. The per-account desktop gateways use the main Filey agent runtime for that capability.

The webhook still processes tasks synchronously, and the claimed message ID provides at-most-once processing rather than a durable retry queue. A crash after claiming or an ambiguous outbound delivery may require the owner to inspect the conversation/Filey and send a new request. It does not claim exactly-once delivery, durable 24/7 jobs, or automatic recovery of an already claimed task.

The hosted Cloud API path still accepts text requests only; no hosted file upload/download, media generation, incoming media/OCR, or typing-indicator change is included here. Live Meta/Telegram/Slack authentication and delivery were not exercised. Provider behavior for webhook retries and Telegram polling/webhook exclusivity is documented in the [official Telegram Bot API](https://core.telegram.org/bots/api#setwebhook).
