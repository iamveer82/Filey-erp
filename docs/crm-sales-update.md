# CRM sales and follow-up update

This update connects the existing Filey CRM, quotation, invoice and AI screens. It uses Filey's current local/cloud storage and installed UI components; no additional CRM service or API key is required.

## Completed changes

1. **Reliable saves and workspace boundaries.** Custom field definitions now use account-, organization- and mode-scoped caches and acknowledged settings saves. Failed loads cannot replace definitions with an empty list. Failed saves keep the editor open. Quotation saves and queued local document transactions reject a changed workspace. Existing authentication, password recovery, account isolation and local/cloud switching checks pass.
2. **Deal → quotation → invoice.** Open a company, contact or deal's **Documents** section. Preparing a quotation opens an unsaved draft with the company and deal context; quantities and prices remain for review. A saved quotation can be linked to a compatible deal. Documents open their actual editors. Conversion preserves document terms, currency and existing FX rates, uses configured invoice numbering, returns an existing conversion on retry and commits local header/lines/quote status atomically. A failed CRM link keeps the saved quotation ID so retrying does not create another quotation.
3. **Today.** CRM has a daily queue for open tasks, incomplete meetings, leads with no recorded activity, and unpaid invoice balances. Draft, cancelled and paid invoices are excluded. Filters cover overdue, today, upcoming work and missing dates. Complete tasks or prepare linked follow-ups. Failed invoice refreshes remove stale balances and offer a retry.
4. **Contextual AI.** Record drawers offer relationship summaries, follow-up drafts, quotation outlines and suggested next steps. Each opens an editable request before the Filey AI composer. The handoff carries its workspace scope. Existing AI provider/local-model settings and action approvals remain in use; opening the preview starts no model request.
5. **Invoice sharing.** The dialog previews the actual attachment bytes with the existing PDF canvas, including every page and zoom controls. Recipient and message stay editable. Recent sharing records distinguish unsent drafts, native handoffs, provider acceptance, a visually observed outgoing message and an unknown outcome. This capped history is scoped to the current account/workspace/device; it is not a delivery-receipt service. SMS drafts contain text/links, not PDF attachments.
6. **CRM organization.** Exact email/phone and company/name matches flag possible duplicates for review, without automatic merges. Bulk edits review the chosen field, value and records, refuse stale rows and report partial results. Company and contact drawers support validated custom fields and preserve values whose definitions were removed. Owner inputs suggest existing owners and unassigned records are labelled clearly. Saved views retain the duplicate filter.

The obsolete custom-field add/update/remove/reorder wrappers and unused display component were removed after checking their callers.

## Verification

The regression suite covers local transactions, failed writes, recovery, workspace switching/copying, custom definitions and values, conversion idempotency, quotation calculations, international documents, CRM workflows, AI gates, document sharing and PDF rendering. Tests use isolated test storage and mocked outbound services.

September 12 release verification: **1,474 tests passed across 211 test files**, all six native Rust library tests passed, and `npm run build` passed. Full lint reported zero errors and 544 existing warnings. The release also corrects stale test setup for workspace-scoped document saves and centralized CRM reports.

Browser checks on `http://127.0.0.1:16422` used the existing Filey QA workspace: Today, deal documents, a prefilled quotation draft, editable AI requests, custom fields, bulk review/cancel and the saved invoice's real PDF preview. Forms were cancelled. No business records or outbound messages were created or changed. The browser reported no console errors during these checks.

## Cloud deployment

`supabase/2026-09-12-crm-sales-workflow.sql` was applied to the hosted Filey project on September 12. It creates the authenticated, security-invoker `filey_convert_quotation` RPC with row locking, a current-organization guard, and atomic header/line/status writes. It does not rewrite existing records or remove prior duplicate invoices. Self-hosted installations must apply it after the existing schema migrations; a missing RPC produces an explicit upgrade message.

The actual SQL passed isolated PostgreSQL 18 checks for atomic rollback, retries, stale versions, ownership, organization boundaries, anonymous access and simultaneous conversions returning one invoice. The repeatable SQL check is `supabase/tests/crm-sales-workflow.sql` and requires an empty disposable database. Hosted catalog verification confirmed authenticated execution, anonymous denial, and security-invoker behavior. No hosted business records were changed. Native backup/restore drills, real password-recovery delivery and live WhatsApp/SMS delivery remain separate operational checks; automated tests do not establish those results. See the [2.11.0 release notes](releases/v2.11.0.md) for distribution details.

AI inference and messaging continue to use the user's configured local models, connected accounts or own keys. This update introduces no shared secret, bundled provider key or claim of unlimited free SMS/API delivery.
