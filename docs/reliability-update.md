# Filey reliability update — September 6, 2026

The current workspace includes repairs to authentication, shared business data access, purchasing, agent document creation, charts and reports, integrations, and in-app help. The frontend is available locally; this is not a published desktop release.

The subsequent [storage and design update](storage-design-update.md) supersedes the earlier switching, cache and offline-save behavior and records the remaining desktop release checks.

The [reporting update](reporting-update.md) moves section insights into Reports and reconciles Overview's charts and reporting data. The latest password-recovery implementation and hosted setup status are tracked in [password recovery](password-recovery.md).

## Changes

| Area | Result |
| --- | --- |
| Password sign-in | Reads the actual form values, including password-manager autofill. Existing short passwords are no longer blocked by the new-account minimum-length rule. Password visibility controls are keyboard accessible. |
| Password recovery | A signed-out user requests a one-time reset link through Resend, verifies Supabase's recovery token, and sets a password without supplying an old password. The verified identity must match the current user. |
| Business data | Cloud lists paginate beyond the server row cap. An initial database failure surfaces an error instead of an empty business. Single-record updates require an acknowledged matching record. Cached reads remain available where supported. |
| Quotations and purchase orders | Cloud header and line replacement uses one authenticated database transaction; an invalid line rolls the operation back. Local saves compensate failed writes. |
| Stock receiving | Fractional quantities are preserved. Cloud receiving locks the order and products, updates stock, acquisition cost and movements together, and records receipt so retries cannot receive the same order twice. |
| Filey AI | Invoice, quotation and purchase drafts link exact matching saved parties and products. Invalid quantities are rejected. Added CRM read, save and lead-conversion tools through the existing permission and agent-mode gates. |
| Charts | Shared chart containers now have explicit heights and can shrink on narrow screens. Record insights retain period selection, chart data tables and CSV export. Negative values are not mistaken for empty data; invalid dates are excluded. |
| Reports | Financial reporting copies normalize document amounts to AED using saved rates where available. Source documents retain their currency. Cancelled invoices are excluded from revenue, and inventory valuation uses acquisition cost. Load failures are surfaced. |
| Integrations | Connections moved out of CRM. Integrations now separates the app directory, built-in connections and provider setup. Availability comes from configuration checks; inactive roadmap entries are hidden. |
| Resend | Authenticated configuration check, validated email payloads, provider timeouts and request idempotency. A failure in local send-count bookkeeping no longer reports an already-sent email as failed. Secrets remain on the server. |
| Help | Working Documentation and Help Center routes, 16 searchable guides, direct section links, a mobile article selector and a small diagnostics download without business data or credentials. |

## Verification

- `npm test -- --reporter=dot`: **133 files, 943 tests passed**.
- `npm run build`: passed, including TypeScript compilation. Existing mixed static/dynamic import warnings remain.
- `npm run lint -- --quiet`: passed.
- Added regression checks cover password autofill and Resend-link recovery, invalid recovery rejection, cloud pagination and failed reads, missing-record updates, financial currency conversion, linked agent-created documents, fractional stock, repeated receiving and failed quotation replacement.
- The existing PDF audit within the suite passed 38 headless tools; 50 tools require interactive or environment-specific checks and were skipped. This does not establish that every desktop or external tool works in every environment.
- Deno type checks passed for the changed email and integration edge functions.
- Live database checks in `supabase/tests/business-reliability.sql` passed: failed line replacement rolls back, repeated receiving creates only one stock movement, quotation lines are replaced rather than duplicated, and anonymous execution is denied. Test records were rolled back.
- Browser checks used the running localhost app and existing records: customer chart bars/trends, period selection, chart data tables, sales bar/pie charts, phone-width layout, documentation search, article navigation and the diagnostics action.
- The authenticated Resend configuration check succeeded. An anonymous email-function configuration request was rejected with HTTP 401. No test email was sent to a customer or user.

## Applied backend changes

The additive, rerunnable `supabase/2026-09-06-business-reliability.sql` migration is applied to the Filey Supabase project. It adds authenticated security-invoker document-save and purchase-receiving functions and the purchase receipt flag. Existing row-level policies continue to control access.

The updated `send-email` edge function is active at version 14; `integrations` is active at version 4. Both validate the bearer token with Supabase Auth inside the function. The management access token was used for authenticated requests only and is not stored in this repository.

The earlier CRM migration and conversion checks are documented in [CRM workspace](crm-workspace.md). No frontend deployment, installer build or update publication was performed in this pass.

## Configuration and known boundaries

- Resend is configured, but live recipient delivery, domain reputation and production quotas have not been tested in this pass. Configuration status does not guarantee delivery. See [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys) and [account limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
- Composio and Zernio still need valid provider credentials before their hosted connections can run. No API keys were fabricated, and no third-party accounts were created. Built-in currency conversion and native messaging/calendar actions remain available without those provider keys.
- WhatsApp click-to-chat and Telegram profile links open conversations. Automated messaging requires the applicable bot/business-channel configuration and a reachable backend. Provider pricing and limits are separate; this update cannot make every external API or AI model free.
- Filey AI uses the existing account permissions, tool policies, memory and skills. This is not unrestricted cross-account access or autonomous model-weight training. This pass does not certify every hosted channel workflow.
- Cloud stock receiving is transactional; accounting propagation follows through the existing retryable, idempotent ledger path. Local collection storage cannot guarantee crash-atomic changes across collections or receipt serialization across simultaneous app instances. Cloud mode provides the stronger transaction guarantees.
- Record counts and monetary reports have different meanings. Receipt-based cash charts count payment receipt records; invoice paid amounts are shown separately. A period without qualifying records remains empty, with no fabricated chart values.
- Password recovery was exercised with automated Auth and Resend-request mocks. A real account password was not changed during browser verification.

Review locally at [Filey](http://127.0.0.1:1420/), [Integrations](http://127.0.0.1:1420/#/integrations), and [Help Center](http://127.0.0.1:1420/#/help).
