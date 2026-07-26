# Connect Hermes, Claude Code & other MCP clients

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) is an open
standard that lets an AI client call tools exposed by an external server.
`filey-erp-mcp` is Filey's MCP server: a small Node process (stdio transport,
Node ≥ 20) that exposes 17 Filey ERP tools — 11 reads, 5 draft writes, and
one confirm-gated action — over the Supabase REST API, authenticated as you.

It runs entirely on your machine. Your credentials never go anywhere except
from this process to your own Supabase project.

---

## 1. Install & run

**Easiest — npx** (no checkout needed):

```bash
npx -y filey-erp-mcp
```

**From source** (this repo):

```bash
cd mcp-server
npm install
npm run build
node dist/index.js        # absolute path: /path/to/Filey-erp/mcp-server/dist/index.js
```

On its own the server just sits on stdio waiting for an MCP client — that
means it's working. Configure your client (§3–§4) to actually talk to it.

---

## 2. Credentials

The server needs three or four environment variables:

| Variable | Required | Where to get it |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase dashboard → your project → **Settings → API → Project URL** |
| `SUPABASE_ANON_KEY` | yes | Same page → **anon public** key |
| `SUPABASE_ACCESS_TOKEN` | either/or | Your Filey user JWT (see below) |
| `FILEY_EMAIL` + `FILEY_PASSWORD` | either/or | The email/password you sign in to Filey with — the server exchanges them for a session itself |

**Access token vs. email/password:** prefer `SUPABASE_ACCESS_TOKEN` if you
have a session JWT handy (e.g. copied from the app's authenticated session /
Supabase Auth). If that's fiddly, `FILEY_EMAIL` + `FILEY_PASSWORD` is fine —
they live only as environment variables in the client config on your own
machine and are used solely to sign in to your Supabase project.

Because the server authenticates as *you*, Postgres row-level security is the
hard boundary: the MCP tools can see and touch exactly what your Filey login
can. Nothing more.

---

## 3. Claude Code

One command registers the server:

```bash
claude mcp add filey \
  -e SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  -e SUPABASE_ANON_KEY=eyJhbGciOi... \
  -e SUPABASE_ACCESS_TOKEN=eyJhbGciOi... \
  -- npx -y filey-erp-mcp
```

(Or `-e FILEY_EMAIL=you@example.com -e FILEY_PASSWORD=…` instead of the token.
From a local build, replace `npx -y filey-erp-mcp` with
`node /path/to/Filey-erp/mcp-server/dist/index.js`.)

Verify inside Claude Code:

```
/mcp
```

You should see `filey` listed as connected with its tools. Then just ask:
"Which invoices are overdue?"

---

## 4. Hermes & other generic clients

Any MCP client that understands the standard JSON server config can run it.
The block looks like this:

```json
{
  "mcpServers": {
    "filey": {
      "command": "npx",
      "args": ["-y", "filey-erp-mcp"],
      "env": {
        "SUPABASE_URL": "https://YOUR_PROJECT.supabase.co",
        "SUPABASE_ANON_KEY": "eyJhbGciOi...",
        "SUPABASE_ACCESS_TOKEN": "eyJhbGciOi..."
      }
    }
  }
}
```

Where to put it, per client:

- **Hermes** — add the `filey` entry to Hermes' MCP servers config (same
  `mcpServers` shape), then restart / reload.
- **Claude Desktop** — `claude_desktop_config.json`
  (`~/Library/Application Support/Claude/` on macOS,
  `%APPDATA%\Claude\` on Windows, `~/.config/Claude/` on Linux). Restart the
  app; the hammer/tools icon should show `filey`.
- **Cursor** — Settings → MCP, or `.cursor/mcp.json` in your project (same
  shape). Use the full path to `node` if `npx` isn't on Cursor's PATH.

For a local build, set `"command": "node"` and
`"args": ["/absolute/path/to/mcp-server/dist/index.js"]`.

---

## 5. Tool reference (all 17)

### Reads — no side effects, org-scoped to your login

| Tool | Arguments | Returns |
|---|---|---|
| `get_financial_summary` | — | Account balances: receivables, payables, cash/bank, income, expense |
| `list_invoices` | `status?` (`draft`/`sent`/`paid`/`overdue`), `limit?` (≤25) | Recent invoices: number, customer, status, dates, currency |
| `get_invoice` | `number` | One invoice in full, incl. line items and totals |
| `list_quotes` | `status?`, `limit?` | Recent quotations |
| `list_orders` | `limit?` | Recent sales orders |
| `list_purchase_orders` | `status?`, `limit?` | Recent purchase orders |
| `list_customers` | `limit?` | Customers with contact details |
| `find_customer` | `query` | Customers matching a name/company (partial match) |
| `list_products` | `query?`, `limit?` | Products with price and stock |
| `list_low_stock` | — | Products at/below reorder level |
| `run_report` | `report`: `sales_by_month` \| `top_customers` \| `receivables_aging` | The report rows |

### Draft writes — always create something you review in Filey

| Tool | Arguments | Side effect |
|---|---|---|
| `create_draft_invoice` | `customer_name`, `items[]` (`description`, `qty?`, `unit_price`), `customer_email?`, `currency?` (default AED), `tax_rate?` (default 5) | Creates a **draft** invoice (`INV-YYYY-A####`). Never sent automatically |
| `create_draft_quote` | `customer_name`, `items[]`, `currency?` | Creates a draft quotation |
| `create_draft_po` | `supplier_name`, `items[]` (`description`, `qty?`, `unit_cost`), `currency?` | Creates a draft purchase order (links the supplier if the name matches) |
| `add_customer` | `name`, `company?`, `email?`, `phone?` | Adds a CRM customer (dedupe with `find_customer` first) |
| `add_product` | `name`, `sku?`, `unit_price?`, `cost_price?`, `reorder_level?` | Adds a product; stock starts at 0 (receive stock in the app) |

No tool can send, finalize, pay, delete, or edit an existing record. Every
write is logged to `audit_log` with `actor = "agent"`.

### Confirm-gated — never executes on its own

| Tool | Arguments | What happens |
|---|---|---|
| `request_payment_reminder` | `invoice_number` | Creates a pending action and returns a 4-digit code. Nothing is emailed until the owner replies `APPROVE <code>` on a connected channel (Telegram/WhatsApp/Slack — see `docs/ai-agent.md`). Codes expire in 24h; `CANCEL <code>` drops it. Requires the channel agent to be deployed and `RESEND_API_KEY` set |

This is deliberate: an MCP client (or a prompt it ingested) can *propose* an
email to a customer, but only you, on your pinned channel, can fire it.

---

## 6. Security

- **Tokens stay on your machine.** Env vars live in your client's config file;
  the server only talks to your Supabase project.
- **RLS is the boundary.** Reads and writes run as your user, so row-level
  security applies exactly as if you were using the app.
- **Draft-only write policy.** The worst a bad prompt can produce is a draft
  you delete. External effects need `APPROVE <code>` on your pinned channel.
- **Revoking access.** Remove the `filey` entry from the client config
  (`claude mcp remove filey` for Claude Code) and the server is gone. To kill
  the credentials themselves: sign out / rotate your session (invalidates the
  JWT), or change your Filey password if you used email/password. Rotating
  the Supabase anon key is *not* required — it never granted anything by
  itself; the user token did.

---

## 7. Try these prompts

- "Which invoices are overdue?"
- "What's low in stock?"
- "Draft an invoice for Acme, 3 consulting days at 900."
- "Show me the receivables aging report."
- "Who were our top customers last quarter?"
- "Request a payment reminder for INV-2026-0042." → then, on Telegram:
  `APPROVE 4821`

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Client shows `filey` as failed/disconnected | Run the command by hand (`npx -y filey-erp-mcp` or `node dist/index.js`) and read the error. Check Node ≥ 20 (`node -v`). |
| "Missing SUPABASE_URL / SUPABASE_ANON_KEY" | Env vars not passed through. In JSON configs they must be inside the server's `env` block; in Claude Code use `-e KEY=value` before `--`. |
| Tools return auth/permission errors | Token expired (JWTs are short-lived) — mint a fresh one, or switch to `FILEY_EMAIL`/`FILEY_PASSWORD` so the server refreshes its own session. |
| Tools return empty data | You're authenticated as the wrong user, or the data belongs to another org. RLS is doing its job — sign in as the owner account. |
| `npx` not found by the client (GUI apps) | GUI clients don't inherit your shell PATH. Use the absolute path to `node` + `dist/index.js` from a local build. |
| `request_payment_reminder` gives a code but nothing ever sends | That's the design — approve it on a connected channel with `APPROVE <code>`. Also confirm the channel agent is deployed and `RESEND_API_KEY` is set. |
| Claude Code: server not listed by `/mcp` | Re-add with the full `-e` flags, then restart the session. `claude mcp list` shows registered servers. |
