# Cloud authority and non-billing Edge audit — 2026-10-04

This wave manually reviewed 72 complete files (4,763 lines at the frozen snapshot) and 14 additional targeted files. Counts include tests and fixtures;
they exclude generated locks and the large canonical schema from complete-file
counts. The full and targeted lists below identify the actual coverage. Exact
full-file ranges are recorded in `output/cloud-audit-reviewed-2026-10-04.json`.
Static reading and passing tests do not prove that every execution path, every
historical migration, or the live deployment is free of defects.

## Confirmed repairs

- Order, quotation and purchase-order children and purchase payments could be
  attached to another author's protected parent through permissive child-row
  policies. An independently shared malformed child could disclose a private
  parent line. Parent visibility now controls child reads; same-workspace parent
  author or current administrator authority controls linked writes. Existing
  private unattached rows remain private. Repair:
  `2026-10-04-document-child-authority.sql`.
- Direct tool-job writes could forge processing/results, modify work after a
  trusted worker claimed it, and bypass admission by choosing the worker engine.
  The insert trigger admits supported, bounded pending specifications once under
  the existing atomic 15-per-hour limit. Clients cannot edit authoritative job
  fields, and can delete only pending jobs. `run-tool` claims and finishes only
  its exact job/user/timestamp and uses separate output paths per claim. Root's
  worker completion fence pairs with this authority. Repair:
  `2026-10-04-tool-job-authority.sql` plus `functions/run-tool/index.ts`.
- MCP draft headers and lines could commit separately, leaving incomplete
  documents on a line failure. The existing invoker save RPC now supports all
  three draft types in one transaction, preserves allowed formatting/tax fields,
  strips ownership and sharing overrides, and rejects unauthorized empty-header
  replacements. This covers draft header/item saves; posting, payments and stock
  are separate workflows. Repair: `2026-10-04-atomic-document-save.sql`.
- Raw workspace device fingerprints/session IDs were readable by ordinary staff
  and former members with a stale profile. A known fingerprint could be
  re-registered to another user. Real membership plus own/admin reads and
  same-owner registration now protect the registry while preserving slot locks
  and revoked sessions. The payment agent's matching client retains own legacy
  registrations and otherwise uses an account-specific cloud install identity.
  Repair: `2026-10-04-workspace-device-authority.sql`.
- Canonical fresh-install invitation helpers still trusted editable profile
  email and could promote an existing member. The narrow canonical fragments
  now use confirmed `auth.users` identity, expiry, row locking, role validation,
  preserved existing membership and revoked competing invitations. These are
  tested from the actual `schema.sql` fragments. The current team-workspaces
  migration already carries these semantics; this is a bootstrap repair, not a
  claim of a newly verified live exploit.
- Email and invitation endpoints buffered unbounded bodies and exposed raw
  SQL/provider error strings. Actual streamed request caps, strict object JSON,
  safe static failures and credentialed `redirect: "error"` requests now cover
  these paths. A stale former-member profile no longer receives its old paid
  team's email quota. Valid attachment and invitation workflows are retained.
- Public lead submission used a race-prone row count for its five-per-hour
  admission. It now reserves through the existing atomic limiter before writes,
  bounds the actual body, redacts raw setup/provider errors, uses idempotent
  bounded email calls and requires a nonempty acceptance receipt. A saved lead
  with failed email/setup is reported truthfully.
- Private overdue invoices always received a customer-portal URL despite public
  lookup requiring a shared invoice. Links now appear only for genuinely shared
  invoices. Provider acceptance remains distinct from delivery.
- Both public document SECURITY DEFINER RPCs exposed the internal `shared_with`
  recipient IDs on valid shared invoices and included persisted child rows from
  another workspace because their joins checked only parent ID. The active
  portal calls `get_shared_doc` (`src/pages/PortalView.tsx:40`); the legacy
  `get_shared_invoice` remained callable too. Actual old definitions at
  `2026-06-17-doc-unification.sql:130` and `customer-portal.sql:9` reproduced both
  failures in disposable PostgreSQL. The bounded pending replacement strips
  only ownership/share authority, requires exact non-null parent/child
  organization equality and retains all other customer-facing fields. No
  historical rows are deleted or rewritten. Repair:
  `2026-10-04-public-document-privacy.sql`, with canonical mirrors.

The earlier 3 October workspace-membership, audit-log privacy and integration
scope/error/redirect repairs were preserved. They are not counted again as new
findings in this wave.

## Focused verification

- Disposable PostgreSQL fixtures reproduce the old child-row, tool-job and
  device authority failures before repair, then verify repaired RLS and repeat
  migration application. Logs: `output/document-child-focused.log`,
  `output/tool-job-authority-focused.log`,
  `output/workspace-device-focused.log`.
- Atomic document fixtures cover all three types, rejected line rollback,
  replacement rollback, immutable ownership, allowed tax/format fields,
  author/admin/shared restrictions and anonymous RPC ACL. Log:
  `output/atomic-document-focused.log`.
- Actual canonical invitation fragments pass forged/unverified/expired email,
  existing-role preservation, sibling revocation and anonymous ACL tests. Log:
  `output/canonical-invitation-focused.log`.
- Public document fixtures load both exact old production RPCs to prove the
  leak despite denied direct anonymous SELECT and current caller RLS. Twice
  applying the privacy repair excludes foreign and null-org lines, protects
  authority metadata and private/targeted-only documents, preserves anonymous
  token lookup, and keeps formula/discount/tax/custom/roundoff/bank/receipt
  outputs. Log: `output/public-document-privacy-focused.log`.
- Ten focused mocked Edge tests passed across run-tool, lead submission,
  invitation/email and reminders. They cover stale and duplicate claims, bodies
  with lying/missing length, no dispatch on rejection, safe SQL/provider errors,
  quotas, acceptance receipts and redirect policy. Log:
  `output/cloud-boundaries-edge-tests.log`.
- Final `deno check --frozen` passed for run-tool, send-email, team-invite,
  lead-contact, overdue-reminders and integrations. Parent owns the consolidated
  full PostgreSQL and Edge runs; their results must be recorded separately.

## Follow-up closure of implementation gaps

The subsequent implementation pass closed the four concrete architecture gaps
recorded during the earlier audit:

- The canonical fresh installer includes the historical workspace/channel
  migrations and `org_channel_reads`, tracked once-only source receipts and all
  current authority/workflow definitions. The entire real PostgreSQL installer,
  signup and existing-Auth provisioning, workspace/invitation/channel contracts,
  row-preserving repeat, explicit repeated upgrades, deleted-profile preservation,
  failure rollback and full/partial legacy refusal passed. The actual catalog
  has 93 tables, 1,192 columns and 143 named functions with zero checked issues.
- Numbering has a scoped atomic reservation and normalized database uniqueness
  contract. The real PostgreSQL suite passed 45 assertions plus eight-way distinct
  allocations, immutable identical replay and unused-reservation preservation.
  Historical duplicate records remain editable without increasing duplicates.
  Root owns the migration and matching local/client allocator; this subtask owns
  its PostgreSQL integration evidence.
- The payment agent implemented and independently verified the atomic invoice,
  payment, stock, sales-order, journal and advance workflows. Their frozen
  definitions are included in the canonical installer and its strict catalog
  check. The separate payroll repair remains owned and verified by that agent.
  Root owns the legacy Stripe total-parity repair and its settlement fixtures.
- Lead/voucher/coupon creation is now a service-only atomic RPC with immutable
  request replay and configured-platform-owner notification. The handler reuses
  the persisted lead/coupon and provider idempotency key. Real PostgreSQL passed
  24 assertions and eight-way replay; four mocked Edge tests and the frozen-lock
  endpoint typecheck passed. No partial row survived injected coupon failure.

Recurrence additionally passed 44 PostgreSQL assertions and eight concurrent
callers creating exactly one cycle. Child/schedule failures rolled back the
document and number reservation. Hidden foreign-workspace legacy lines reject
generation rather than silently omitting part of the invoice. Generic draft
replacement now preserves the original author's child ownership after an
administrator edits a document. Actual installed-policy fixtures prove that the
original staff author can save invoice, quotation and PO lines again without
retaining stale lines; invalid replacements roll back, and hidden or incompatible
historical children are rejected before deletion. Generic invoice/PO calls
cannot finalize or undo posted documents outside the trusted workflow dispatcher.
The strict
runtime checker has 21 passing tests covering 32 explicit new RPC signatures,
body drift, the real export's source whitelist, effective client/service
privileges and narrow replay ledger policies. All 12 explicit current upgrades
were applied twice with saved fixture rows unchanged.

The payment agent's last bounded ACL repair also closes direct calls to internal
posting/payment/stock/account helpers: all 12 internal signatures, including
both advance overloads, are executor-only. This prevents API callers from
bypassing the outer workflow's immutable replay receipt. Public dispatchers,
pure calculators and permission-scoped boolean helpers retain their intended
access. The actual installer catalog checks the effective executor, client and
service grants; this does not change the separate direct-table limitation below.

The final business definition also rejects reuse of an overdrawn historical
private advance pool. The payment agent reproduced matching-author legacy
borrowing without this guard, then verified that new spending and deposit
reductions fail atomically while note edits, safe release and cancellation
preserve a route to reconciliation. The canonical installer includes that
frozen definition and its exact source/ACL contract.

Evidence: `output/bootstrap-complete-tests.log`, `output/bootstrap-catalog.json`,
`scripts/test-schema-bootstrap-local.mjs`, `scripts/test-recurrence-local.mjs`,
and [Supabase bootstrap instructions](../../supabase/BOOTSTRAP.md). Generated
schema composition and actual catalog compatibility are tested; this does not
extend the earlier complete-file manual review count to every generated line.

## Remaining deployment and domain limits

- Transactional workflow RPCs are not the exclusive write authority for every
  table. Authorized own-row REST/import/local-to-cloud sync still operates under
  RLS, module/MFA, identity, numbering and sync triggers. Direct writes to
  `invoice_docs`, `invoice_doc_items`, `invoice_payments`, `purchase_orders`,
  `purchase_order_items`, `po_payments`, `orders`, `order_items` and `advances`
  can bypass the dispatcher's coordinated stock/accounting effects. Related
  `accounts`, `transactions`, `products` and `stock_movements` also retain
  authorized manual/sync mutation paths. Requiring every financial mutation to
  use a dispatcher needs a designed import/sync/manual-entry contract; a blanket
  trigger would break those existing workflows. The repaired generic save RPC
  independently permits ordinary invoice/PO draft-to-draft saves only and
  preserves parent-owned lines; it does not claim to close this broader boundary.
- Deployment gateway behavior for trusted proxy/IP headers is unverified. The
  new limiter does not certify resistance to forged proxy headers or a
  distributed multi-IP flood.
- The public RPC leak is repaired locally, but production row consistency and
  deployed definitions remain unverified. Current RLS prevents ordinary new
  cross-workspace child insertion; the reproduced child leak requires persisted
  malformed historical/admin-created rows. The member-ID leak needs no malformed
  rows. No live exploit or affected customer row is asserted. The per-user versus
  per-workspace lifetime of personal follow-ups remains a domain question. Reply
  pagination loads complete bounded-root threads and still needs performance
  testing for unusually large threads.
- No live schema, gateway, Realtime behavior, storage deployment, provider,
  customer message, purchase or payment was exercised. Migrations and matching
  handlers are pending and unpublished. Local offline/disposable evidence does
  not prove production deployment state.

## Complete-file manual review manifest

- `supabase/customer-portal.sql`
- `supabase/2026-09-06-business-reliability.sql`
- `supabase/2026-09-12-crm-sales-workflow.sql`
- `supabase/2026-09-06-international-business.sql`
- `supabase/2026-09-06-crm-workspace.sql`
- `supabase/follow-ups.sql`
- `supabase/2026-09-06-work-items.sql`
- `supabase/2026-09-20-sync-manifest.sql`
- `supabase/2026-09-22-batched-sync.sql`
- `supabase/2026-09-12-shared-record-permissions.sql`
- `supabase/2026-09-12-module-access.sql`
- `supabase/2026-09-25-workspace-sync-recovery.sql`
- `supabase/tool-jobs.sql`
- `supabase/2026-09-30-tool-path-integrity.sql`
- `supabase/2026-06-24-user-folders.sql`
- `supabase/2026-08-13-integration-keys.sql`
- `supabase/2026-08-22-agent-hardening.sql`
- `supabase/2026-07-11-function-grants-hardening.sql`
- `supabase/2026-06-30-audit-trail-hardening.sql`
- `supabase/2026-08-31-entity-links.sql`
- `supabase/2026-06-29-channel-messages.sql`
- `supabase/2026-07-08-org-devices.sql`
- `supabase/2026-09-28-cloud-device-limit.sql`
- `supabase/2026-09-04-stock-no-clamp.sql`
- `supabase/2026-07-09-rls-payment-tables.sql`
- `supabase/2026-07-10-sync-state.sql`
- `supabase/2026-09-12-sync-conflict-protection.sql`
- `supabase/recurring-invoices.sql`
- `supabase/2026-07-11-schema-sync-local-drift.sql`
- `supabase/2026-10-01-team-owner-integrity.sql`
- `supabase/2026-09-20-profile-insert-scope.sql`
- `supabase/2026-09-30-mfa-enforcement.sql`
- `supabase/2026-09-28-team-attachments.sql`
- `supabase/2026-09-28-team-codes.sql`
- `supabase/2026-09-20-edge-rate-limits.sql`
- `supabase/tests/business-reliability.sql`
- `supabase/2026-10-04-document-child-authority.sql`
- `supabase/2026-10-04-tool-job-authority.sql`
- `supabase/2026-10-04-atomic-document-save.sql`
- `supabase/2026-10-04-workspace-device-authority.sql`
- `supabase/functions/agent-jobs/index.ts`
- `supabase/functions/run-tool/index.ts`
- `supabase/functions/send-email/index.ts`
- `supabase/functions/overdue-reminders/index.ts`
- `supabase/functions/team-invite/index.ts`
- `supabase/functions/lead-contact/handler.ts`
- `supabase/functions/lead-contact/index.ts`
- `supabase/functions/_shared/admin-workspace.ts`
- `supabase/functions/_shared/agent-jobs.ts`
- `supabase/functions/_shared/overdue-reminders.ts`
- `supabase/functions/_shared/email-delivery.ts`
- `supabase/functions/_shared/rateLimit.ts`
- `supabase/functions/_shared/team-invitation.ts`
- `supabase/functions/_shared/billing-request.ts`
- `supabase/functions/lead-contact/handler.test.ts`
- `supabase/functions/_shared/team-invitation.test.ts`
- `supabase/functions/_shared/overdue-reminders_test.ts`
- `supabase/functions/_shared/run-tool_test.ts`
- `supabase/functions/_shared/transactional-email-security_test.ts`
- `scripts/fixtures/document-child-setup.sql`
- `scripts/fixtures/document-child-assertions.sql`
- `scripts/fixtures/tool-job-authority-setup.sql`
- `scripts/fixtures/tool-job-authority-assertions.sql`
- `scripts/fixtures/atomic-document-setup.sql`
- `scripts/fixtures/atomic-document-assertions.sql`
- `scripts/fixtures/workspace-device-setup.sql`
- `scripts/fixtures/workspace-device-assertions.sql`
- `scripts/fixtures/canonical-invitation-assertions.sql`
- `supabase/2026-10-04-public-document-privacy.sql`
- `scripts/fixtures/public-document-setup.sql`
- `scripts/fixtures/public-document-baseline.sql`
- `scripts/fixtures/public-document-assertions.sql`

## Targeted manual review manifest

- `supabase/schema.sql`: Invitation identity and acceptance; table/function/policy inventory; new authority and atomic-save blocks. Not read in full.
- `supabase/2026-09-20-team-workspaces.sql`: Current verified-email, role/expiry, workspace RPC and chat pagination definitions.
- `supabase/2026-09-30-scheduled-write-integrity.sql`: Initial scheduled write and reminder authority definitions.
- `supabase/2026-09-19-basic-web-access.sql`: Initial cloud entitlement checks and current_org dependencies.
- `supabase/2026-09-28-member-avatars.sql`: Initial member read visibility and avatar permissions.
- `supabase/2026-10-03-letters.sql`: Numbering and collection uniqueness.
- `supabase/2026-10-01-packaging-lists.sql`: Numbering and collection uniqueness.
- `src/lib/api.ts`: Document header/item saves, invoice mutations, tool-job client operations. Frontend owned by root.
- `src/lib/license.ts`: Install identity, device RPC registration/list/logout. Compatibility repair owned by payment agent.
- `src/lib/docNumber.ts`: Max-plus-one number generation.
- `worker/index.js`: Queue claim and completion authority coordination. Worker repair owned by root.
- `scripts/test-rls-local.mjs`: Initially read fixture harness; later edited isolated cloud blocks, not a full final-file reread.
- `supabase/MIGRATIONS.md`: Current deployment evidence and new pending upgrade instructions.
- `supabase/2026-06-17-doc-unification.sql`: Complete active public RPC definition (lines 130-193), with targeted document-model migration compatibility reading.
