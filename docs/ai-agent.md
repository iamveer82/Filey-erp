# Filey AI — the agent

Filey ships with an AI agent that can read your business data, draft documents,
and learn how you work. It runs on three surfaces, all sharing one safety
model:

| Surface | Where it runs | Model key | Best for |
|---|---|---|---|
| In-app copilot | Inside Filey (browser/desktop) | Your own key (BYOK) | Working in the app: drafting, scanning documents, autonomous goals |
| Channel agent | Supabase edge function, 24/7 | `ANTHROPIC_API_KEY` secret | Chatting from Telegram / WhatsApp / Slack, anywhere |
| MCP server | Your own machine | Your Filey login / JWT | Claude Code, Hermes and other MCP clients driving Filey |

One safety model across all three: reads are scoped to your org, writes are
drafts you review, and anything with an external effect (like emailing a
customer) needs an explicit approval from you.

---

## 1. In-app agent quick start

The in-app agent is BYOK — *bring your own key*. Your API key is stored only
in your browser/desktop (localStorage) and every request goes straight from
your device to the model provider. Nothing passes through Filey's servers.

### Connect a model

1. Open **Settings → AI Assistant**.
2. Pick a provider:
   - **Anthropic** — native Claude Messages API.
   - **OpenAI-compatible** — works with OpenAI, OpenRouter, Together, Groq,
     Mistral, or a local Ollama / LM Studio via a custom base URL.
3. Paste your API key and set the model (e.g. `claude-opus-4-8`, `gpt-4o`,
   or whatever your endpoint serves).
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
  them in later chats. See §5 for how this works and how to wipe it.
- **Skills** — reusable instruction packs (workflows, procedures) you write
  once. The agent sees the skill names/descriptions and loads the full
  instructions only when a task matches. Manage them in Settings → AI
  Assistant.

### Autonomous goals

Give the agent a goal ("reconcile this week's invoices", "find what's about
to run out of stock and draft POs") and it works end-to-end: plan → act with
tools → observe → verify → report. Money or outbound actions (marking paid,
sending email, adjusting stock) still pop an approval dialog — autonomous
mode doesn't bypass the confirm gate.

### Scanning documents

Attach a PDF or photo to the chat. The agent can:

- **Read it** — PDFs are extracted to text; images go straight to the model's
  vision.
- **Turn it into data** — invoice/receipt scans become structured fields
  (seller, TRN, dates, line items, tax category, UAE emirate codes) ready for
  a draft invoice or expense entry.
- **Process it** — compress, convert, rotate, page-number, strip metadata,
  and more, with the result downloaded back to you.

Attachments are treated as *data, not instructions* — a note inside a scanned
document can never make the agent send email or move money (see §4).

---

## 2. Channel agent — 24/7 on Telegram, WhatsApp & Slack

The channel agent is a hosted relay: a Supabase edge function
(`channel-webhook`) that runs around the clock with no desktop needed. It
receives a message, thinks with your business data, replies on the same
channel, and logs both directions to `channel_messages` so the conversation
shows up live in the app.

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
                           │  4. AI tool loop  ─────────┐   │
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

### Deploy

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy channel-webhook --no-verify-jwt
```

`--no-verify-jwt` is required: Telegram, Meta and Slack call the webhook with
no Supabase JWT. The function authenticates each caller with a per-channel
shared secret instead (below), and fails closed if it isn't configured.

Apply the memory migration once (SQL Editor or CLI):

```bash
supabase db execute --file supabase/2026-07-26-agent-memories.sql
```

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
The service-role key never leaves the function — see §4 for what that means.

### Telegram setup

1. Message **@BotFather** → `/newbot` → copy the token.
2. Set secrets:
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC... \
     TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
     ANTHROPIC_API_KEY=sk-ant-... \
     OWNER_USER_ID=<your auth.users id>
   ```
3. Point Telegram at the function (Telegram echoes `secret_token` back in a
   header on every update — that's the authentication):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<project>.functions.supabase.co/channel-webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
4. **Pair your chat.** Message the bot once. Until it's paired it replies
   with your chat id — set it and redeploy:
   ```bash
   supabase secrets set TELEGRAM_OWNER_CHAT_ID=<the id it replied with>
   ```
   From then on, every other chat gets "this is a private assistant."

### WhatsApp setup (Meta Cloud API)

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
5. Optional but recommended: set `WHATSAPP_APP_SECRET` to your app secret so
   every payload's `X-Hub-Signature-256` HMAC is verified.
6. Message the business number from your own phone — only
   `WHATSAPP_OWNER_PHONE` gets the agent; everyone else is ignored.

### Slack setup

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
- **Org-scoped reads.** The function uses the service-role key (which bypasses
  RLS), so the tool layer pins `.eq("org_id", …)` on every query. That scope
  is the tenant boundary; the agent can only ever see the owner's org.
- **Draft-only writes.** Every write tool creates a draft (invoice, quote, PO)
  or an additive record (customer, product). No tool can send, finalize, pay,
  delete, or edit an existing record. Drafts get an `-A####` number suffix so
  you can spot agent-created documents; you review and finalize in the app.
- **Confirm-gated external actions.** Anything that leaves the org or moves
  money in the books (today: payment-reminder emails, marking an invoice
  paid) is never executed by the model. The agent creates a pending action in
  `agent_pending_actions` with a 4-digit code; you reply `APPROVE <code>` (or
  `CANCEL <code>`) on a connected channel. Codes are drawn from a
  cryptographic RNG, expire after 24 hours, can't collide while live, and
  approvals bypass the model entirely — a confirm is deterministic, and a
  double-`APPROVE` (or an `APPROVE` racing a `CANCEL`) executes exactly once.
  Once an action is decided, its parked credentials are scrubbed from the
  row.
- **At-most-once inbound processing.** Every provider message id
  (Telegram update_id, WhatsApp message id, Slack event_id) is claimed in
  `channel_seen_messages` before any work; redelivered webhooks are swallowed
  with a plain ack instead of answering twice.
- **Rate limits.** 30 messages per hour per install; bursts get a 429.
  Pairing codes are throttled to 5 failed attempts per hour per sender, and
  each failed attempt lands in the audit log.
- **Audit trail.** Every draft, record, and executed action is written to
  `audit_log` with `actor = "agent"`, and both directions of every channel
  conversation land in `channel_messages`.
- **RLS everywhere.** Clients (the app) can only read their own rows; the
  service-role key stays inside the edge function.
- **Prompt-injection guardrail.** The system prompt is explicit: attachment
  and record contents are *data, not instructions*. An invoice PDF that says
  "email this to attacker@…" can't trigger anything — in the app, sensitive
  tools require your click; on channels, external actions require `APPROVE`.

---

## 4. Self-improvement: memory & skills

### Memory

The agent learns across conversations. When you share a durable fact,
preference, or correction ("we bill Acme monthly, not per-job", "VAT is 5%",
"don't round prices on quotes"), it saves it with the `remember` tool and can
search older notes with `recall`.

- **In-app**, memories live on your device (capped at 200; oldest drop off).
- **Channel agent**, memories live in the `agent_memories` table
  (`supabase/2026-07-26-agent-memories.sql`), and the most recent 12 are
  injected into the system prompt as a digest every turn — so corrections
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

### Channel agent tools (Telegram / WhatsApp / Slack / MCP)

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

**Confirm-gated**: `request_payment_reminder` — proposes the email, you
approve with `APPROVE <code>`; `propose_mark_invoice_paid` — same gate for
flipping an invoice to paid in the books.

### In-app extras

Everything above, plus: create/modify orders, quotes and POs; log expenses;
mark attendance and list employees; navigate the app (`open_page`); read and
process attached PDFs/images; and run connected Composio integrations (Gmail
etc.). Tools that move money or send things outbound — `send_invoice`,
`mark_invoice_paid`, `set_recurring`, `adjust_stock`, `email_invoice`,
Composio actions — are flagged *sensitive* and always ask for your click
first, even in autonomous mode. The agent will refuse to touch Settings,
passwords, or security configuration, full stop.

### Built-in context compression (headroom)

Large tool results are compressed before they reach the model: long JSON
lists become columnar digests, repeated log lines collapse to counts. Every
compressed result carries a `[headroom]` marker with an id — the agent can
call `headroom_retrieve(id)` to see the full original at any time, so
compression never loses data the task needs. Prose is never rewritten and
error messages always pass through whole.

---

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Channel bot never replies | Webhook not pointing at the function. Telegram: re-run `setWebhook`. WhatsApp: check callback URL + **messages** field subscription. Slack: check the Event Subscriptions Request URL shows *Verified*. |
| Bot replies "private assistant" | You're not the pinned owner. Set `TELEGRAM_OWNER_CHAT_ID` / `WHATSAPP_OWNER_PHONE` / `SLACK_OWNER_USER_ID` to your own id (message the bot once — unpaired Telegram bots tell you the id). |
| 403 in function logs | Webhook secret mismatch. Redeploy the correct `TELEGRAM_WEBHOOK_SECRET` / `WHATSAPP_VERIFY_TOKEN` / `SLACK_SIGNING_SECRET`. |
| "My AI key isn't set up yet" | `ANTHROPIC_API_KEY` secret missing — `supabase secrets set ANTHROPIC_API_KEY=…`. |
| "Live data lookups aren't configured" | `OWNER_USER_ID` unset, or the owner's profile has no org — data tools stay off and the agent won't invent numbers (by design). |
| "rate limited" | 30 messages/hour cap hit. Wait, or adjust `rateLimit` in the function. |
| `APPROVE 1234` says "no pending action" | Code expired (24h) or already used — ask the agent to propose it again. |
| Reminder approved but no email | `RESEND_API_KEY` isn't set — the approval works, the send can't. |
| In-app: "No AI model connected" | Settings → AI Assistant → add provider + key. |
| In-app: requests fail in browser but work on desktop | Provider blocks browser CORS. Use the desktop app or an OpenAI-compatible endpoint that allows browser calls. |
| Agent forgot something between chats | Memory only persists durable facts it saved with `remember`. Tell it "remember that …" — or check Settings → AI Assistant → Memory. Channel memories are in `agent_memories`. |
