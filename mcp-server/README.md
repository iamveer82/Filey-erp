# filey-erp-mcp

MCP (Model Context Protocol) server for **Filey ERP**. It lets external AI clients —
Claude Code, Hermes, Cursor, or any MCP-compatible host — read financials and create
draft documents in Filey over a stdio transport, backed by Supabase/PostgREST with
row-level security enforced as *your* user.

- 17 tools: financial summaries, invoices, quotes, purchase orders, customers,
  products, low-stock alerts, built-in reports, draft-only writes, and a
  human-approval-gated payment reminder flow.
- **Draft-only writes.** The agent can create draft invoices, quotes and POs, add
  customers and products — it cannot send, approve, or post anything.
- **Confirm-gated side effects.** Sending a payment reminder requires the owner to
  reply `APPROVE <code>` on a connected channel.

## Install

From source:

```bash
npm i && npm run build
npm start            # or: node dist/index.js
```

Or run the published package directly:

```bash
npx -y filey-erp-mcp
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | yes | Your Supabase project URL, e.g. `https://xyz.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | Supabase anon/public key |
| `SUPABASE_ACCESS_TOKEN` | one of the two auth options | A Filey **user JWT**. Pinned as the `Authorization` header on every request so Postgres RLS runs as that user. |
| `FILEY_EMAIL` + `FILEY_PASSWORD` | one of the two auth options | Alternative to a token: the server signs in with password on first use and pins the returned access token. |

The server also resolves your `user_id` and `org_id` from the `profiles` table on
first tool call; every query is pinned to `org_id` and every insert carries
`user_id` + `org_id` explicitly.

## Claude Code

```bash
claude mcp add filey \
  -e SUPABASE_URL=https://xyz.supabase.co \
  -e SUPABASE_ANON_KEY=eyJhbGciOi... \
  -e SUPABASE_ACCESS_TOKEN=eyJhbGciOi... \
  -- npx -y filey-erp-mcp
```

**Getting a user JWT:** sign in to the Filey web app, then grab the access token from
the browser devtools (Application → Local Storage → the `sb-*-auth-token` entry →
`access_token`), or sign in via the API:

```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}' | jq -r .access_token
```

Instead of `SUPABASE_ACCESS_TOKEN` you can pass credentials directly:

```bash
claude mcp add filey \
  -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... \
  -e FILEY_EMAIL=you@example.com -e FILEY_PASSWORD=your-password \
  -- npx -y filey-erp-mcp
```

## Hermes / Cursor / generic MCP client

Add to your MCP settings JSON (e.g. `~/.cursor/mcp.json` or your Hermes config):

```json
{
  "mcpServers": {
    "filey": {
      "command": "npx",
      "args": ["-y", "filey-erp-mcp"],
      "env": {
        "SUPABASE_URL": "https://xyz.supabase.co",
        "SUPABASE_ANON_KEY": "eyJhbGciOi...",
        "SUPABASE_ACCESS_TOKEN": "eyJhbGciOi..."
      }
    }
  }
}
```

## Tool reference (17)

| Tool | Kind | Description |
|---|---|---|
| `get_financial_summary` | read | Account balances, invoice counts by status, outstanding/overdue receivables, low-stock count |
| `list_invoices` | read | Invoices with totals; filter `status` = draft/sent/paid/overdue (overdue = sent & past due), `limit` ≤ 25 |
| `get_invoice` | read | One invoice by number, head + line items + net/tax/total |
| `list_quotes` | read | Quotations, newest first |
| `list_orders` | read | Sales orders — the `orders` table may not exist; returns a helpful error pointing at `list_invoices` |
| `list_purchase_orders` | read | Purchase orders, newest first |
| `list_customers` | read | CRM customers |
| `find_customer` | read | Case-insensitive search on customer name/company |
| `list_products` | read | Products / inventory |
| `list_low_stock` | read | Products where `reorder_level > 0` and `quantity <= reorder_level` |
| `run_report` | read | `sales_by_month` (6 months, non-draft, totals by YYYY-MM) · `top_customers` (90-day totals, top 10) · `receivables_aging` (current / 1-30 / 31-60 / 61-90 / 90+) |
| `create_draft_invoice` | write (draft) | Draft invoice `INV-<year>-A####`, head + items, returns `{number, total}` |
| `create_draft_quote` | write (draft) | Draft quotation `Q-<year>-A####` |
| `create_draft_po` | write (draft) | Draft purchase order `PO-<year>-A####`; links `supplier_id` by fuzzy name match when possible |
| `add_customer` | write | Insert a CRM customer |
| `add_product` | write | Insert a product (quantity starts at 0) |
| `request_payment_reminder` | confirm-gated | Creates an `agent_pending_actions` row and returns a 4-digit `approval_code`; the reminder is only sent after the owner replies `APPROVE <code>` on a connected channel |

All write tools record an `audit_log` entry with actor `mcp-agent`. Every tool
returns `{error: "..."}` payloads on failure instead of crashing.

## Security

- **Token stays local.** Credentials live only in your MCP client config and the
  local process environment; they are never sent anywhere except your own Supabase
  project.
- **RLS is the boundary.** The server uses the anon key plus your user JWT, so every
  query is subject to the same Postgres row-level security policies as the web app.
  The agent can only see and touch what your user can.
- **Org scoping.** Every query additionally pins `.eq("org_id", orgId)` and every
  insert includes `user_id` + `org_id` explicitly.
- **Draft-only writes.** Invoices, quotes and POs are created with `status: 'draft'`
  — a human reviews and sends them in the Filey UI.
- **APPROVE flow.** Outbound side effects (payment reminders) go through
  `agent_pending_actions` with a one-time 4-digit code; nothing is sent until the
  owner approves on a connected channel.
- **Stdio hygiene.** All logging goes to stderr; stdout carries JSON-RPC only.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing SUPABASE_URL and/or SUPABASE_ANON_KEY` on tool call | Set the env vars in your MCP client config and restart the client. |
| `Missing auth: set SUPABASE_ACCESS_TOKEN ... or FILEY_EMAIL + FILEY_PASSWORD` | Provide one of the two auth options. |
| `Sign-in failed for ...` | Check FILEY_EMAIL/FILEY_PASSWORD; prefer the JWT if your org uses SSO. |
| `Failed to load profile for user ...` | The token doesn't belong to a Filey user with a `profiles` row — re-copy the access token from a signed-in session. |
| `new row violates row-level security policy` | Expired or wrong-user JWT; get a fresh token. |
| `Could not list orders: ...` from `list_orders` | Expected on deployments without an `orders` table — use `list_invoices` / `list_purchase_orders`. |
| Tools don't show up in the client | Run `npm run smoke` in the package dir; it handshakes the server offline and prints the 17 tool names. |

## Development

```bash
npm run build   # tsc → dist/
npm run smoke   # offline stdio handshake + tools/list assertion (17 tools)
npm start       # run the server
```
