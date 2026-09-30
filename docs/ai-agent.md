# Filey AI — the agent

Filey ships with an AI agent that can read your business data, draft documents,
and learn reusable procedures. It can run through the following surfaces:

| Surface | Where it runs | Model key | Best for |
|---|---|---|---|
| In-app copilot | Inside Filey (browser/desktop) | BYOK or configured Filey Coin model | Working in the app: drafting, scanning documents, autonomous goals |
| Desktop WhatsApp agent | Paired phone and Filey desktop, while open | Your configured in-app model | Owner tasks and replies through the local QR bridge |
| Desktop Telegram agent | Private paired Telegram chat and Filey desktop, while open | Your configured in-app model | Owner tasks, photos, documents and returned files through a dedicated bot |
| Hosted channel agent | Supabase edge function | `ANTHROPIC_API_KEY` secret | Single-owner cloud lookups and drafts through Telegram / WhatsApp Cloud / Slack |
| MCP server | Your own machine | Your Filey login / JWT | Claude Code, Hermes and other MCP clients driving Filey |

Business data stays scoped to the signed-in workspace and the user's module
permissions. In-app actions follow the selected approval mode: **Accept edits**
asks before sensitive actions, **Manual** asks before writes, **Plan** blocks
writes, and **Auto** pre-approves enabled tools. Desktop WhatsApp and Telegram
use that same runtime, but sensitive actions still require an exact chat approval
even in Auto. Hosted channels have a smaller tool set, their own owner checks,
and confirmation codes. [Computer access](computer-use.md) starts automatically
when the signed-in Windows desktop chat opens. Actions still follow the same approval checks.
It has no five-minute expiry and stays available across chat turns until Stop, chat exit, sign-out or app closure. Remote and scheduled runs cannot start it.

---

## 1. In-app agent quick start

The in-app agent supports BYOK — *bring your own key* — and configured Filey
Coin models. BYOK provider credentials are saved in the desktop OS credential
vault, scoped to the signed-in account/workspace. Browser credentials stay in
memory until reload; they are not persisted in localStorage. Non-secret settings
and credential names may be stored locally. Signing out or changing account drops
plaintext credential caches; unattributed legacy keys are quarantined rather than
given to the next account.

BYOK model requests use your provider endpoint directly, through the native proxy
on desktop. Filey Coin requests use Filey's managed billing relay instead. These
are separate funding paths; BYOK requests do not spend Filey Coins. Enter provider
credentials in Settings rather than putting passwords or keys in a chat.

### Connect a model

1. Open **Settings → AI Assistant**.
2. Pick a provider:
   - **Anthropic** — native Claude Messages API.
   - **OpenAI-compatible** — works with OpenAI, OpenRouter, Together, Groq,
     Mistral, or a local Ollama / LM Studio via a custom base URL.
3. Paste your API key and select a model served by your endpoint. Local endpoints
   can run without a hosted API key; choose a model with tool calling and, for
   screenshots, image support.
4. Save. The chat orb in the app is now live.

On the desktop app, requests go through a native proxy, so providers that
block browser CORS calls (Groq, Mistral, xAI, Ollama Cloud, …) work there too.

### Persona and vibe

On first run the assistant introduces itself and asks your name and role. In
Settings you can rename the assistant (default "Filey"), pick an accent
colour, and choose a vibe: **Friendly, Professional, Concise, Encouraging, or
Playful**. Persona is remembered permanently on that device.

### Memory and skills

- **Memory** — the agent saves durable facts you share ("our VAT is 5%",
  "always CC accounts@acme.com", "main supplier is Acme Trading") and recalls
  them in later chats. See §4 for how this works and how to wipe it.
- **Skills** — reusable instruction packs (workflows, procedures) you write
  once. The agent sees the skill names/descriptions and loads the full
  instructions only when a task matches. Manage them in Settings → AI
  Assistant.

### Autonomous goals

Give the agent a goal ("reconcile this week's invoices", "find what's about
to run out of stock and draft POs") and it works end-to-end: plan → act with
tools → observe → verify → report. Multi-step tasks show a checklist and live
action results. Autonomous mode follows the same approval mode and capability
switches as normal chat. Stop cancels pending approvals and remaining actions;
it cannot undo an action already accepted by another app or service.

### Scanning documents

Attach a PDF or photo to the chat. The agent can:

- **Read it** — PDFs are extracted to text; images go straight to the model's
  vision.
- **Turn it into data** — invoice/receipt scans become structured fields
  (seller, TRN, dates, line items, tax category, UAE emirate codes) ready for
  a draft invoice or expense entry.
- **Process it** — compress, convert, rotate, page-number, strip metadata,
  and more, with the result downloaded back to you.

Attachments are treated as *data, not instructions*. Their contents do not grant
authorization; runtime capability, module and approval checks still apply (see §3).

---

## 2. Messaging agents

### Desktop WhatsApp and Telegram — the shared Filey runtime

Both desktop connections call `runRemoteAgentTurn`, which uses the same model,
memory, skills, tool engine and module permissions as Filey chat. They operate on
the workspace currently open in Filey, including local records in local mode.
Keep the signed-in desktop app open and the connection healthy. A web deployment
does not install these native gateways.

**WhatsApp:** open **Integrations → WhatsApp**, connect the local QR bridge and
verify the owner number. Only that authenticated owner can run the agent. Use
text, supported photos/documents, or voice notes when transcription is configured.
Generated files, including invoice PDFs, are returned to the source chat after
the provider accepts the upload. See the desktop WhatsApp notes below for account
binding and the unofficial transport's limits.

**Telegram:** open **Integrations → Telegram** in the desktop app. Create a
dedicated bot with @BotFather, enter its token and connect. The token is saved in
the OS vault for the current Filey account/workspace. From your private Telegram
chat, send the displayed `PAIR <code>` within ten minutes. The code has 20
uppercase hexadecimal characters; knowing the bot's username alone cannot pair
an account. Groups, bots and other senders cannot control the agent.

Filey verifies the bot's identity and refuses a bot that already has a webhook;
it does not remove another application's webhook. Polling skips the previous
backlog on a new connection and rejects messages more than five minutes old.
One Filey window polls the bot at a time. Requests run serially in a bounded
queue; typing is refreshed while a task runs. Telegram supports text, photos and
documents up to 12 MB; voice and other message types are not supported yet.
Use **Reconnect** deliberately after signing in or changing workspace; an old
owner chat is not silently given control of a different workspace.

For either connection, `/help`, `/status`, `/stop` and `/new` provide controls.
`/stop` cancels queued and active channel work; `/new` also clears that channel
conversation's context. Each task has a time limit. An action already accepted
by another app/provider may finish after cancellation, so check Filey before
repeating a timed-out action.

Remote sensitive tools always require a delivered **APPROVAL REQUIRED** proposal.
Reply `YES` within 15 minutes to authorize exactly that tool name and argument
set once, in the same account/workspace, channel and conversation. The approval
is held in memory, is consumed once even if execution fails, and is discarded on
workspace/session changes or app restart. An unseen or failed reply cannot create
an approvable proposal. Manual also asks for ordinary writes; Plan blocks them.
Long proposals, interactive editing, login/CAPTCHA and paid-media submission
require returning to Filey.

These connections cannot start or borrow general Windows computer access or the
owner's personal browser. If the user has explicitly enabled **Agent computers
(optional)**, an approved remote task can use its separate visible browser
workspace. This is a per-conversation browser profile in the Windows app, not a
separate OS or Docker container. User takeover pauses agent actions. Sending a
generated file back to the authenticated source is part of the requested task;
sending to a different recipient needs a separate request and exact approval.

### Hosted channel agent — Telegram, WhatsApp Cloud and Slack

The channel agent is a hosted relay: a Supabase edge function
(`channel-webhook`) that accepts provider webhooks with no desktop needed. It
receives a message, thinks with the configured owner's cloud business data, replies on the same
channel, and logs both directions to `channel_messages` so the conversation
shows up in the app. This is one `OWNER_USER_ID` per installation, not per-user
SaaS routing. Its cloud data tools require that owner's active owner/admin
membership in the current organization. It does not run the desktop tool engine,
read local files, export PDFs, control a browser, or process incoming media.

Processing happens inside the webhook request, with no durable background task
queue. Provider timeouts or a crash after a message was claimed can leave a task
without a reply. Inspect the app before sending a new request; deduplication is
not an exactly-once execution or delivery guarantee.

```
 Telegram ─┐
           │  webhook POST (verified per channel)
 WhatsApp ─┼──────────────────────────────┐
           │                              ▼
 Slack ────┘               ┌───────────────────────────────┐
                           │  channel-webhook (Deno)        │
                           │  1. verify sender signature    │  fail-closed
                           │  2. pin to owner chat/phone/ID │  strangers rejected
                           │  3. rate limit (30 msg/hr)     │
                           │  4. dedup + bounded AI loop┐   │
                           │  5. send reply             │   │
                           └──────┬─────────────────────┼───┘
                                  │ service role        │ tools, org-scoped
                                  ▼                     ▼
                          Supabase Postgres ── reads (.eq org_id on every query)
                           ├─ channel_messages    drafts (invoice/quote/PO)
                           ├─ agent_pending_actions  ← APPROVE <code> gate
                           ├─ agent_memories         ← remember/recall
                           └─ audit_log
                                  ▲
                     Filey app reads channel_messages via RLS (live view)
```

### Hosted deployment prerequisites

Apply the required channel tables, owner/pairing and dedup migrations, memory
table and edge rate counter before deploying. Existing setup is documented in
`supabase/MIGRATIONS.md`; relevant files include `2026-06-29-channel-messages.sql`,
`2026-08-13-agent-channels.sql`, `2026-08-22-agent-hardening.sql`,
`2026-07-26-agent-memories.sql` and `2026-09-20-edge-rate-limits.sql`.

Also apply **`supabase/2026-09-30-channel-agent-drafts.sql`** before enabling the
current hosted draft tools. It adds the service-only
`filey_channel_create_draft(uuid,text,text,jsonb)` transaction: header, lines and
audit entry commit together or all roll back. It verifies current owner/admin
membership, constrains document fields and validates totals. If it is missing,
draft creation fails closed instead of leaving a partial document. The same
function is included additively in `schema.sql`; do not replay the entire schema
snapshot on production as a migration. This change has been tested on disposable
PostgreSQL data; applying it to production is a separate deployment step.

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy channel-webhook --no-verify-jwt
```

`--no-verify-jwt` is required: Telegram, Meta and Slack call the webhook with
no Supabase JWT. The function authenticates each caller with a per-channel
shared secret instead (below), and fails closed if it isn't configured.

### Secrets

Set with `supabase secrets set KEY=value`. Required means fail-closed — the
function refuses traffic until it's set.

| Secret | Required | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | The agent's model key |
| `OWNER_USER_ID` | yes | `auth.users.id` this install belongs to (messages/memories/audit are logged under it) |
| `TELEGRAM_BOT_TOKEN` | for Telegram | From @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | for Telegram | Any long random string; Telegram echoes it back so we can verify |
| `TELEGRAM_OWNER_CHAT_ID` | for Telegram | The owner's chat id — the only chat the agent answers |
| `TELEGRAM_OWNER_USER_ID` | for Telegram groups | The owner's numeric user id — group chats must ALSO match this sender id or messages are refused (fail-closed). Private chats don't need it. |
| `WHATSAPP_TOKEN` | for WhatsApp | Permanent access token from your Meta app |
| `WHATSAPP_PHONE_NUMBER_ID` | for WhatsApp | The business number's id in Meta Cloud API |
| `WHATSAPP_VERIFY_TOKEN` | for WhatsApp | Random string you invent; Meta checks it during webhook setup |
| `WHATSAPP_APP_SECRET` | for WhatsApp | Meta app secret — every payload's `X-Hub-Signature-256` HMAC is verified against it; unsigned posts are **rejected** |
| `WHATSAPP_OWNER_PHONE` | for WhatsApp | Owner's number in international format (e.g. `9715XXXXXXXX`) — the only sender the agent answers |
| `SLACK_BOT_TOKEN` | for Slack | Bot OAuth token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | for Slack | From your Slack app's Basic Information page — every request's `X-Slack-Signature` is verified against it; unsigned requests are **rejected** |
| `SLACK_OWNER_USER_ID` | for Slack | Owner's Slack member id (`U…`) — the only user the agent answers |
| `AGENT_MODEL` | optional | Default `claude-haiku-4-5-20251001` |
| `RESEND_API_KEY` | optional | Needed to actually send approved payment-reminder emails |
| `REMINDER_FROM` | optional | Sender address for reminders, default `Filey <reminders@filey.app>` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
The service-role key never leaves the function — see §3 for what that means.

### Hosted Telegram setup

1. Message **@BotFather** → `/newbot` → copy the token.
2. Set secrets:
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC... \
     TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
     ANTHROPIC_API_KEY=sk-ant-... \
     OWNER_USER_ID=<your auth.users id>
   ```
3. Obtain your numeric private chat ID through a trusted administrative setup
   and set `TELEGRAM_OWNER_CHAT_ID` before accepting tasks. For a group, also set
   `TELEGRAM_OWNER_USER_ID` to the owner's numeric sender ID. The unconfigured
   webhook does not reply with a bootstrap owner ID.
4. Point Telegram at the function (Telegram echoes `secret_token` back in a
   header on every update — that's the authentication):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<project>.functions.supabase.co/channel-webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
   Only the pinned owner can run tasks. The separately supported approved
   `connect_channel` flow stores credentials in `agent_channels` and issues a
   six-digit, 15-minute pairing code; Telegram pairing must happen privately.
   That hosted flow differs from the desktop pairing procedure above.

### Hosted WhatsApp setup (Meta Cloud API)

1. Create a Meta developer app at developers.facebook.com, add the
   **WhatsApp** product, and register a business phone number.
2. Create a **permanent token**: Meta Business Suite → System users → add
   assets (your WhatsApp app) → generate token with `whatsapp_business_messaging`.
   Test tokens expire in 24h — don't ship one.
3. Set secrets:
   ```bash
   supabase secrets set WHATSAPP_TOKEN=<permanent token> \
     WHATSAPP_PHONE_NUMBER_ID=<phone number id> \
     WHATSAPP_VERIFY_TOKEN=$(openssl rand -hex 16) \
     WHATSAPP_OWNER_PHONE=9715XXXXXXXX
   ```
4. In the app's **WhatsApp → Configuration** panel, set the callback URL to
   `https://<project>.functions.supabase.co/channel-webhook` and the verify
   token to your `WHATSAPP_VERIFY_TOKEN`. Meta calls the function with a
   `hub.challenge` handshake; the function answers only when the verify token
   matches. Subscribe to the **messages** webhook field.
5. Required: set `WHATSAPP_APP_SECRET` to your app secret so
   every payload's `X-Hub-Signature-256` HMAC is verified.
6. Message the business number from your own phone — only
   `WHATSAPP_OWNER_PHONE` gets the agent; other senders are refused.

### Hosted Slack setup

1. Create an app at api.slack.com/apps → **From scratch**, pick your workspace.
2. **OAuth & Permissions** → Bot Token Scopes: add `chat:write` plus
   `im:history` (DMs) — add `channels:history` / `groups:history` too if you
   want the agent to answer in channels. Install the app to the workspace and
   copy the **Bot User OAuth Token** (`xoxb-…`).
3. **Basic Information** → copy the **Signing Secret**.
4. **Event Subscriptions** → enable, set the Request URL to
   `https://<project>.functions.supabase.co/channel-webhook` (Slack verifies
   it with a challenge the function answers), then subscribe to bot events:
   `message.im` (and `message.channels` if you enabled channel history).
5. Set secrets:
   ```bash
   supabase secrets set SLACK_BOT_TOKEN=xoxb-... \
     SLACK_SIGNING_SECRET=<signing secret> \
     SLACK_OWNER_USER_ID=U01234567
   ```
   Your member id is on your Slack profile (⋮ → Copy member ID).
6. DM the bot — only `SLACK_OWNER_USER_ID` gets the agent.

---

## 3. Safety model

This is the part to read before trusting the agent with a business.

- **Fail-closed secrets.** If a channel's verification secret is unset or the
  signature/header doesn't match, the request is rejected. Without this,
  anyone could POST fake messages and make the agent talk — or worse, approve
  pending actions.
- **Per-channel owner pinning.** The webhook secret proves a message came
  from Telegram/Meta/Slack, not *who* sent it. So each channel is pinned to
  exactly one owner identity (`TELEGRAM_OWNER_CHAT_ID`, `WHATSAPP_OWNER_PHONE`,
  `SLACK_OWNER_USER_ID`). Everyone else is turned away. This is a single-owner
  design: one install = one owner.
- **Hosted workspace boundary.** The function uses the service-role key, which
  bypasses RLS. Before offering cloud data tools, it checks the configured
  owner's profile organization and active owner/admin membership. Every business
  query, including child rows, uses that organization. Credentials-table errors
  fail closed rather than falling back to an older environment credential.
- **Hosted draft/additive writes.** Direct business writes create a draft (invoice, quote, PO)
  or an additive record (customer, product). No tool can send, finalize, pay,
  delete, or edit an existing record. Draft numbers use a prefix, year and
  `-A` followed by a random 12-character hexadecimal suffix; review and finalize
  them in the app. The transaction migration prevents partial header/line writes.
- **Hosted confirmation gates.** Payment-reminder emails, cross-channel messages
  and channel connections are proposed in `agent_pending_actions` with a 4-digit
  code. Reply `APPROVE <code>` (or `CANCEL <code>`) from the same authenticated
  channel and chat that received the proposal, in the same current workspace.
  Legacy proposals without that binding must be proposed again. Codes use a
  cryptographic RNG, expire after 24 hours, can't collide while live, and
  approvals bypass the model entirely. A conditional claim prevents two approvals
  from executing the same pending action; parked credentials are scrubbed in that
  claim. A crash or ambiguous provider timeout can still leave an uncertain
  outcome. This is not a promise of exactly-once delivery. Hosted marking an
  invoice paid is disabled: recording a real payment requires Filey's accounting
  workflow, and older pending mark-paid actions are refused.
- **At-most-once inbound processing.** Every provider message id
  (Telegram update_id, WhatsApp message id, Slack event_id) is claimed in
  `channel_seen_messages` before model/business-tool work; redelivered webhooks
  get an acknowledgement instead of a second run. A failed dedup claim aborts
  processing. A claimed message is not automatically replayed after a later crash.
- **Hosted limits.** 30 parsed owner task messages per hour per install; bursts
  get a 429. Receipts, unsupported non-text updates and unpaired senders do not
  spend the task quota. Request bodies are limited to 256 KiB. The hosted model
  loop allows at most six rounds and 18 tool calls, with a 90-second loop budget
  and 30-second model-request timeout. Tool arguments are validated at runtime,
  including date, currency, quantity and price bounds; drafts have at most 30 lines.
  Pairing codes are throttled to 5 failed attempts per hour per sender, and
  each failed attempt lands in the audit log.
- **Audit trail.** Hosted writes and action outcomes are audited with
  `actor = "agent"`. Accepted incoming tasks and provider-confirmed outbound
  replies are logged under the configured owner in `channel_messages`; failed or
  partial sends are not logged as successful replies.
- **Client permissions.** App requests remain subject to account/workspace RLS
  and module access, including shared-record rules. Hosted channel messages are
  restricted to their account. The service-role key stays in the edge function.
- **Prompt-injection guardrail.** Attachments, records, tool results and webpages
  are treated as untrusted observations, not instructions or approvals. Runtime
  capability, module and confirmation checks enforce the boundaries; prompts
  alone are not a guarantee against every model mistake. Exact remote approval
  is required even when the in-app mode is Auto.

---

## 4. Self-improvement: memory & skills

### Memory

The agent learns across conversations. When you share a durable fact,
preference, or correction ("we bill Acme monthly, not per-job", "VAT is 5%",
"don't round prices on quotes"), it saves it with the `remember` tool and can
search older notes with `recall`.

- **In-app and desktop WhatsApp/Telegram**, memories live on your device,
  scoped to the account/workspace (capped at 200; oldest drop off).
- **Hosted channel agent**, memories live in the `agent_memories` table
  (`supabase/2026-07-26-agent-memories.sql`). Each turn injects up to 12 notes,
  ranked by relevance with recent notes filling remaining places, so corrections
  become standing instructions on the next message, not just the current chat.

Never ask the agent to remember secrets (API keys, passwords): memory is
plaintext and is injected into the prompt every turn.

**Wiping memory**

- In-app: **Settings → AI Assistant → Memory → Clear all** (or delete
  individual entries).
- Channel agent: clear the table in the SQL Editor:
  ```sql
  delete from agent_memories where user_id = '<OWNER_USER_ID>';
  ```

### Skills

Skills are reusable instruction packs you write once — "how we onboard a
customer", "month-end checklist", a house style for quotes. Only names and
descriptions sit in the prompt (cheap); the agent calls `use_skill` to load
full instructions when a task matches. Corrections you'd repeat every session
("always do X before Y") are better saved as a skill than re-explained.

---

## 5. What the agent can do

### Hosted channel agent tools (Telegram / WhatsApp Cloud / Slack)

**Reads** (org-scoped): `get_financial_summary` (receivables, payables,
cash/bank, income/expense balances) · `list_invoices` (filter
draft/sent/paid/overdue) · `get_invoice_detail` (one invoice, line items +
computed subtotal/VAT/total) · `get_vat_summary` (output vs input VAT over a
period) · `list_expenses` · `expense_totals` (spend by category) ·
`stock_valuation` (inventory at cost & retail) · `list_low_stock` ·
`run_report` (`sales_by_month` | `top_customers` | `receivables_aging`) ·
`find_customer`.

**Draft writes** (you review in Filey): `create_draft_invoice` (default VAT
5%) · `create_draft_quote` · `create_draft_po` · `add_customer` ·
`add_product` · `log_expense`.

**Confirm-gated**: `request_payment_reminder` proposes an email; `send_message`
proposes text to an explicit recipient; `connect_channel` proposes a provider
connection. Approve through the originating chat with `APPROVE <code>`.

**Memory**: `remember` and `recall`. Hosted tools cannot mark invoices paid,
export/send PDFs or operate the desktop browser. A missing child query or failed
tool returns an error rather than a fabricated zero total or completion claim.

### In-app and desktop WhatsApp/Telegram tools

Everything above, plus: create/modify orders, quotes and POs; log expenses;
mark attendance and list employees; navigate the app (`open_page`); read and
process attached PDFs/images; and run connected Composio integrations (Gmail
etc.). Tools that move money or send things outbound — `send_invoice`,
`mark_invoice_paid`, `set_recurring`, `adjust_stock`, `email_invoice`,
Composio actions — are flagged *sensitive*. Tools also check the current user's
module permissions and enabled capabilities. In-app Accept edits and Manual
require confirmation, Plan blocks writes, and Auto runs enabled tools without
another prompt. Desktop WhatsApp/Telegram sensitive actions still require the
exact 15-minute chat approval described in §2, even in Auto.

The shared runtime can inspect supported attachments, run the enabled file tools,
and return saved outputs to the authenticated source chat. Interactive file
editing and paid media generation still require the user to open Filey and use
the relevant controls. Remote requests cannot use general native computer access
or the personal browser; their optional agent-computer workspace has separate
enablement and approval checks. MCP is a separate local server with its own
configured tool surface; it is not routed through the hosted webhook.

### Built-in context compression (headroom)

Large tool results are compressed before they reach the model: long JSON
lists become columnar digests, repeated log lines collapse to counts. Every
compressed result carries a `[headroom]` marker with an id — the agent can
call `headroom_retrieve(id)` while that output remains in the bounded in-memory
cache (up to 40 entries, one-hour expiry, at most 200,000 characters per stored
original). Older or larger observations may require re-reading the source. Prose
is not rewritten and error payloads are kept intact within output limits. The
hosted relay uses a separate bounded JSON preview, not this desktop retrieval cache.

---

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Desktop Telegram never replies | Keep Filey open and signed in. Connect/reconnect in Integrations, pair privately before the ten-minute code expiry and use a dedicated bot without an existing webhook. Check the connection state and AI setup. |
| Desktop WhatsApp never replies | Check the paired bridge, owner number, current account binding and AI setup. Reconnect in Integrations; a web deployment cannot replace the desktop sidecar. |
| Hosted channel bot never replies | Check function configuration and provider webhook. Telegram: check `setWebhook` and the owner pin. WhatsApp: check callback URL + **messages** subscription. Slack: check the Request URL is verified. Look for a failed/expired request before repeating writes. |
| Hosted bot replies "private assistant" | The sender does not match the configured owner. Correct the numeric Telegram owner IDs, WhatsApp owner phone or Slack member ID through trusted administration. The unconfigured bot does not send a bootstrap owner ID. |
| 403 in function logs | Check the Telegram secret header, Meta app-secret signature or Slack signing secret/timestamp. WhatsApp's verify token authenticates setup, not message signatures. |
| "This assistant isn't configured yet" | Check hosted `ANTHROPIC_API_KEY`, owner configuration and current channel credentials. Missing configuration fails closed. |
| Hosted business tools unavailable | Check `OWNER_USER_ID`, its profile organization and active owner/admin membership. A regular member cannot access organization-wide service-role tools. |
| Hosted draft cannot be created | Apply and verify `2026-09-30-channel-agent-drafts.sql` and inspect internal logs. Do not bypass the transaction with legacy header/line inserts. |
| "rate limited" | Hosted 30 task messages/hour cap hit. Wait before retrying. |
| `APPROVE 1234` refused | It must match the proposal's owner, channel, chat and current workspace, and be pending within 24 hours. Expired, used or legacy unbound proposals must be proposed again. |
| Desktop `YES` did not approve an action | Reply to a successfully delivered exact proposal in the same chat within 15 minutes. Restart, workspace/session changes or different arguments require a new proposal. |
| Reminder approved but no email | Check `RESEND_API_KEY`, sender configuration and provider result. Approval claims an action; it does not prove email delivery. Check for an ambiguous send before retrying. |
| In-app: "No AI model connected" | Settings → AI Assistant → add provider + key. |
| In-app: requests fail in browser but work on desktop | Provider blocks browser CORS. Use the desktop app or an OpenAI-compatible endpoint that allows browser calls. |
| Agent forgot something between chats | Memory only persists durable facts it saved with `remember`. Tell it "remember that …" — or check Settings → AI Assistant → Memory. Channel memories are in `agent_memories`. |

## Learning and channel reliability — September 2026

The app, copilot and desktop WhatsApp/Telegram agents now put relevant saved memories
ahead of unrelated recent notes. Recall supports Arabic and other Unicode
words. When a user corrects a saved fact, the agent can use `remember` with
`replace_id` from `recall` to replace it; it does not have to retain both
contradictory versions. Storage failures are returned as errors instead of
claiming the fact was saved.

Ordinary in-app conversations and desktop WhatsApp/Telegram runs now also record tool
failures in the bounded device journal used by autonomous tasks. Subsequent
runs receive those observations so they can adapt. This is learning through
memory and prior outcomes, not model retraining or autonomous code changes.
Existing approval rules still apply.

Hosted Telegram, WhatsApp Cloud and Slack share the owner's `agent_memories`
table. Their recall now ranks relevant notes and supports `replace_id`.
Device-local memory, skills and run journals remain on the device; they are
not automatically shared with hosted channels.

Channel connection proposals now require the verification credentials:
WhatsApp needs `phone_number_id` and `app_secret`; Slack needs
`signing_secret`. Telegram registers its webhook on approval. WhatsApp and
Slack return the remaining provider setup steps, without claiming the
connection is already live. New pairing codes expire after 15 minutes,
must be used privately for Telegram, and cannot overwrite another concurrent
pairing. Unused older codes without an expiry must be replaced by reconnecting.
Already paired channels keep their identity. Credential changes and disabled
channels propagate to warm webhook instances within 30 seconds.

Long replies are split into bounded Unicode-safe messages. Delivery is only
accepted when the provider acknowledges it; failures and partial sends do not
produce a successful outbound log. An ambiguous timeout is not retried
automatically because the provider may already have accepted the message.
Provider acceptance is not a read receipt or proof of final device delivery.
`WHATSAPP_GRAPH_VERSION` can override the default `v23.0` endpoint.

### Deploy and verify

The current hosted draft update requires
**`supabase/2026-09-30-channel-agent-drafts.sql`** in addition to the channel,
memory, hardening and rate-limit migrations described in §2. It has not been
deployed as part of this code review. Desktop Telegram uses the existing shared
runtime and native gateway; it does not require the hosted webhook.

1. Run the frontend's required checks. For the hosted changes, run
   `deno test --allow-env --allow-read --deny-net --lock=deno.lock --frozen supabase/functions/channel-webhook`,
   `deno check --lock=deno.lock --frozen supabase/functions/channel-webhook/index.ts`,
   and `node scripts/test-channel-agent-local.mjs` (disposable database only).
2. Apply the transaction migration, verify its service-only grant and workspace
   checks, then deploy `channel-webhook` with `--no-verify-jwt`. It verifies provider
   signatures itself; keep the owner identity and provider secrets configured.
3. Publish the web build or rebuild the desktop app and its WhatsApp sidecar as
   appropriate. Telegram requires the new native `telegram_request` gateway;
   updating web assets alone cannot install it.
4. From the paired owner account, ask the bot to remember a harmless preference,
   correct it, and recall it. Verify the corrected fact from another hosted
   channel belonging to the same owner.
5. Ask for a read-only business summary and compare it with Filey. Confirm that
   a proposal cannot be approved from another chat/workspace, and that draft
   header/lines either all save or all roll back. Check long replies, an
   unsupported attachment and a disconnected channel before relying on it.
   Automated tests do not prove live provider delivery; use a dedicated test
   account for an installed-build/provider acceptance pass.

Provider references: [Telegram Bot API](https://core.telegram.org/bots/api),
[Slack chat.postMessage](https://docs.slack.dev/reference/methods/chat.postmessage),
and [Meta WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

### Desktop WhatsApp delivery and account binding

The desktop bridge now waits for WhatsApp to accept text and PDF uploads before
reporting success. A disconnected socket, missing file, rejected upload or missing
message ID returns an error to Filey. A timeout is ambiguous: check the conversation
before retrying. Provider acceptance does not mean the recipient has read the message.

Pairing belongs to one Filey account and organization. Existing pairings require one
deliberate **Connect** in **Integrations → WhatsApp** after this update; they are not
assigned automatically. Local/cloud switching within that account retains the binding.
Another account cannot send through or command that pairing: use **Re-pair** to remove
the old phone session and scan your own phone. Owner-number preferences are scoped to
the account; older unscoped owner numbers must be entered again. Signing out stops the
bridge, and unbound or signed-out sessions cannot run the owner agent.

Incoming voice notes are checked against the signed-in owner before transcription.
Repeated provider message IDs are ignored within the bridge's bounded replay window.
Chat approvals authorize one matching call once; timed-out runs are aborted, and
queued requests from a different workspace are discarded. Tools already in progress
may finish, so inspect the app before repeating a timed-out action.

Rebuild **both** the desktop app and `tools/wa-bridge/index.mjs` sidecar for this
protocol update; the sidecar build in `build.ps1` includes `delivery.mjs`. A web-only
update cannot install the native bridge. The local QR bridge still requires the
desktop app to remain open. It uses an unofficial WhatsApp transport, so a paired
phone and a healthy session are required; no shared API key is bundled. Hosted
WhatsApp, Telegram and Slack continue to require the provider credentials and
webhook setup described above. Hosted Slack app mentions now reach the same owner
gate, and batched WhatsApp messages use their matching contact names.
