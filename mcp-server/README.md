# filey-erp-mcp

MCP (Model Context Protocol) server for **Filey ERP**. It lets external AI clients —
Claude Code, Hermes, Cursor, or any MCP-compatible host — read financials and create
draft documents in Filey over a stdio transport.

It runs against either backend:

- **Local mode** — reads and writes the desktop app's own SQLite database. No account,
  no network, no Supabase project. This is the default when the desktop app is
  installed and no `SUPABASE_URL` is configured.
- **Cloud mode** — Supabase/PostgREST with row-level security enforced as *your* user.

- 17 tools: financial summaries, invoices, quotes, purchase orders, customers,
  products, low-stock alerts, built-in reports, draft-only writes, and
  guidance to request and approve payment reminders in a paired channel.
- **Draft-only writes.** The agent can create draft invoices, quotes and POs, add
  customers and products — it cannot send, approve, or post anything.
- **Confirm-gated side effects.** MCP cannot bind approvals to a messaging actor.
  Request the reminder in your paired channel and approve the proposal there.

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

## Local mode (offline, no account)

Point an MCP client at your desktop install and every tool works against the data
already on the machine:

```bash
claude mcp add filey -e FILEY_LOCAL=1 -- npx -y filey-erp-mcp
```

That's the whole setup. The server finds `filey-erp.db` in the app-data folder
(`%APPDATA%\com.iamvi.filey-erp` on Windows, `~/Library/Application Support/…` on
macOS, `~/.config/…` on Linux), honouring the `data_dir.txt` pointer if you moved
your data folder in **Settings → Data**. Pass `FILEY_LOCAL_DB=/full/path/filey-erp.db`
to override.

Notes:

- MCP writers use SQLite transactions for collections, generated IDs and sync
  journals. The updated desktop UI validates cached reads against stored bytes
  and compares its entire read set before committing collection/journal writes.
  If an edit races another process, refresh and retry the reported conflict;
  failed stale saves cannot overwrite the competing records. Older desktop
  binaries must be updated before editing alongside MCP.
- Drafts created here remain on the device. The journal preserves pending changes
  for a later explicitly confirmed transfer to cloud mode; local mode does not
  upload them automatically.
- Tagged records respect the selected workspace and author. Other users' private
  rows are hidden; explicitly shared rows in the selected workspace are readable.
  Cached administrator labels do not bypass this rule. Older ownerless offline
  records remain visible within that workspace. When multiple cached profiles exist, set `FILEY_LOCAL_USER_ID`
  explicitly. Damaged collections or sync journals block writes and preserve
  their original bytes for recovery.
- `request_payment_reminder` returns `requires_channel_proposal` without storing
  an unbound approval code or sending anything.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `FILEY_LOCAL` | local mode | `1` forces local mode even when `SUPABASE_URL` is set |
| `FILEY_LOCAL_DB` | local mode | Full path to `filey-erp.db`; overrides auto-detection |
| `FILEY_LOCAL_USER_ID` | local mode with multiple profiles | Select the exact cached profile; ambiguous defaults are rejected |
| `SUPABASE_URL` | cloud mode | Your Supabase project URL, e.g. `https://xyz.supabase.co` |
| `SUPABASE_ANON_KEY` | cloud mode | Supabase anon/public key |
| `SUPABASE_ACCESS_TOKEN` | one of the two auth options | A Filey **user JWT**. Pinned as the `Authorization` header on every request so Postgres RLS runs as that user. |
| `FILEY_EMAIL` + `FILEY_PASSWORD` | one of the two auth options | Alternative to a token: the server signs in with password and supabase-js keeps the session refreshed automatically (no expiry babysitting). |

The server also resolves your `user_id` and `org_id` from the `profiles` table on
first tool call; every query is pinned to `org_id` and every insert carries
`user_id` + `org_id` explicitly.

Cloud draft creation requires the authenticated `filey_save_document` RPC from
`supabase/2026-10-04-atomic-document-save.sql`. Header and items commit together;
the MCP server reports a save error if that migration is unavailable.

Sales reports use posted invoices and subtract credit notes. Receivables subtract
workspace payments and exclude credit notes, drafts and cancelled documents.
Reports return `by_currency` groups (or `receivables_by_currency` for the summary);
flat totals remain available only when the result has at most one currency.

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
| `run_report` | read | Posted sales minus credit notes by month (6 months) or customer (90 days, top 10); outstanding receivables by age. Separate currency groups. |
| `create_draft_invoice` | write (draft) | Draft invoice `INV-<year>-A####`, head + items, returns `{number, total}` |
| `create_draft_quote` | write (draft) | Draft quotation `Q-<year>-A####` |
| `create_draft_po` | write (draft) | Draft purchase order `PO-<year>-A####`; links `supplier_id` only when the name uniquely matches |
| `add_customer` | write | Insert a CRM customer |
| `add_product` | write | Insert a product (quantity starts at 0) |
| `request_payment_reminder` | guidance | Validates the sent invoice and returns `requires_channel_proposal`; request and approve the reminder in the paired conversation. No message or pending action is created here. |

Write tools attempt an `audit_log` entry with actor `mcp-agent`. Every tool
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
- **APPROVE flow.** Messaging proposals are created and approved by the paired
  channel agent, which binds the action to the current workspace and actor.
  Stdio MCP tools cannot create portable approval codes or send reminders.
- **Stdio hygiene.** All logging goes to stderr; stdout carries JSON-RPC only.

## Restricted Hermes pilot

The backend pilot starts a separate, short-lived MCP child for one verified Filey
user/workspace. It must explicitly set `FILEY_MCP_MODE=hermes-pilot`. With that
mode absent (or `standard`), the existing 17-tool local/cloud MCP is unchanged.
An unknown mode is an error, rather than a fallback to unrestricted tools.

The runner supplies this exact child environment in addition to the Node runtime
environment. Values come from the authenticated backend, never model arguments:

```text
FILEY_MCP_MODE=hermes-pilot
FILEY_HERMES_BINDING={"version":1,"user_id":"<authenticated-user-UUID>","org_id":"<current-workspace-ID>","data_mode":"cloud"}
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon-JWT-or-sb_publishable-key>
SUPABASE_ACCESS_TOKEN=<authenticated-user-JWT>
```

The pilot accepts only cloud mode and a user JWT. It refuses local database
configuration, email/password authentication, service-role tokens, secret/admin
API keys and a binding whose user or organization differs from the verified
Supabase user/profile. Production URLs require HTTPS; HTTP loopback is supported
for development Supabase and the throwaway test fixture. Redirects are refused.
JWT claims are only an early rejection check; `auth.getUser` verifies the token
with Supabase before access is granted. The binding is pinned for the process
lifetime; changing it, the mode, endpoint or credentials requires a new child.

The only exposed pilot tools are:

| Tool | Required module access |
|---|---|
| `get_financial_summary` | accounting, invoicing, inventory |
| `list_invoices`, `get_invoice` | invoicing |
| `list_quotes` | quoting |
| `list_orders` | orders |
| `list_purchase_orders` | purchase-orders |
| `list_customers`, `find_customer` | customers |
| `list_products`, `list_low_stock` | inventory |
| `run_report` | reports, invoicing |

Current membership and module permissions are verified through
`filey_module_access` at startup and before/after each call. Owners/admins and
members with unrestricted (`null`) modules retain the same module rights as
Filey. Private/shared record access remains enforced by Postgres RLS under the
user JWT; the module gate does not grant access to another user's private rows.
If a scope changes or permission is revoked during a read, the result is discarded
and the caller receives a generic error. Draft, issue, send, delete, reminder,
SQL and filesystem operations are not exposed by the pilot.

Keep the user JWT exclusively in this MCP child, outside Hermes. An authenticated
Filey relay should give Hermes only an opaque job capability for the fixed
allowlist. This child is not a shared multi-user server; Hermes still needs
whole-process isolation, controlled network access and a trusted plugin/tool
configuration. The cloud pilot cannot read offline users' device databases.

Validation commands after `npm run build`:

```text
npm run smoke
npm run smoke:local
npm run smoke:pilot
```

The pilot test launches the actual built stdio server and uses fixture-only
Supabase HTTP responses. It covers startup/list/calls, malformed binding and
privileged credentials, cross-user/workspace checks, live role revocation and
post-read result suppression; it does not verify a deployed Supabase project.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing SUPABASE_URL and/or SUPABASE_ANON_KEY` on tool call | Set the env vars in your MCP client config and restart the client. |
| `Missing auth: set SUPABASE_ACCESS_TOKEN ... or FILEY_EMAIL + FILEY_PASSWORD` | Provide one of the two auth options. |
| `Sign-in failed for ...` | Check FILEY_EMAIL/FILEY_PASSWORD; prefer the JWT if your org uses SSO. |
| `Failed to load profile for user ...` | The token doesn't belong to a Filey user with a `profiles` row — re-copy the access token from a signed-in session. |
| `new row violates row-level security policy` | Expired or wrong-user JWT; get a fresh token. |
| `...JWT expired` / `Expired authentication token` / `PGRST301` | The pinned `SUPABASE_ACCESS_TOKEN` ran out — restart the MCP server with a fresh token, or switch to `FILEY_EMAIL`/`FILEY_PASSWORD` so the session refreshes automatically. |
| `Could not list orders: ...` from `list_orders` | Expected on deployments without an `orders` table — use `list_invoices` / `list_purchase_orders`. |
| Tools don't show up in the client | Run `npm run smoke` in the package dir; it handshakes the server offline and prints the 17 tool names. |
| `Local mode requested but no Filey database found` | The desktop app hasn't run on this machine, or its data folder was moved — set `FILEY_LOCAL_DB` to the full path of `filey-erp.db`. |
| Local mode returns empty results | Check you're on the right database: the server logs `local mode — <path>` to stderr on the first tool call. |

## Development

```bash
npm run build       # tsc → dist/
npm run smoke       # offline stdio handshake + tools/list assertion (17 tools)
npm run smoke:local # drives the real tool handlers against a throwaway SQLite db
npm start           # run the server
```

Requires Node >= 22.5 (local mode uses the built-in `node:sqlite`).
