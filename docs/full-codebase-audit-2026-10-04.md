# Filey codebase audit — 4 October 2026

This audit found and repaired concrete security, concurrency, financial and
workflow defects in the local `codex/packaging-lists` checkout. Version remains
3.0.10. No changes were deployed, published, committed or sent to the updater;
no customer records, live payments, provider requests or outgoing messages were
used for verification.

The inherited working tree already contained substantial ongoing work and the
3 October repairs. Those changes were preserved. The findings below distinguish
new repairs from remaining gaps rather than claiming that this snapshot is free
of vulnerabilities.

## Coverage and method

The baseline inventory contained 1,106 selected source/configuration/test files.
The completion inventory contains 1,167: 686 first-party source/configuration files,
478 test/fixture files and three vendored source files. The inventory records line
counts and SHA-256 hashes, excludes generated outputs, dependencies and build
directories, and does not count JSON manifests/locks in its source-line totals.
Those manifests were inspected separately where relevant.

| Area | Source/config files | Test/fixture files |
| --- | ---: | ---: |
| Frontend pages | 72 | 38 |
| Frontend components | 168 | 79 |
| Frontend libraries | 163 | 225 |
| App shell | 7 | 4 |
| Cloud functions and SQL | 181 | 38 |
| Native desktop | 24 | 0 |
| MCP | 6 | 0 |
| Mobile wrappers | 13 | 0 |
| Sidecars | 8 | 5 |
| Conversion worker | 4 | 2 |
| Build/scripts/configuration | 40 | 87 |

Three vendored frontend files are additional to this table. Some native/MCP tests
are inline in source files or executable smoke scripts rather than separate
files. The automated route/action scan examined 396 runtime modules, found 397
reachable modules and 1,303 page actions; its 14 direct route declarations do
not include every route assembled by the module registry.

Coverage evidence is in `output/full-audit-2026-10-04-inventory.json`, with the
initial snapshot preserved as `output/full-audit-2026-10-04-baseline-inventory.json`.
The route/action evidence is `output/erp-page-action-audit.json`.

Manual coverage is recorded separately:

- Cloud/data: 72 complete files and 14 targeted files, with exact full-file
  ranges in `output/cloud-audit-reviewed-2026-10-04.json` and the lists in the
  [cloud report](audits/2026-10-04-cloud-data-audit.md).
- Native/bridge/MCP/mobile: 82 complete files, including tests/configuration;
  large in-app agent files have 24 named review ranges. See
  `output/native-audit-reviewed-2026-10-04.json`,
  `output/agent-boundaries-reviewed-2026-10-04.json` and the
  [native/agent report](audits/2026-10-04-native-mcp-audit.md).
- Billing/payroll: endpoint, payment helper, wallet, entitlement and device
  reviews are recorded in the [billing report](audits/2026-10-04-billing-payroll-audit.md).
- Frontend/workers: full reads of the reconciliation parser, CSV parser,
  document numbering, credential/session/module guards, payslip screen and
  worker claim helper; targeted review of receipt editor loads/saves/sharing,
  quotation sharing, local blob reads, sync/import boundaries and API financial
  summaries. The large API and document-editor files were not read in full.

These lists overlap and must not be added together as a unique manual file
count. Inventory, static analysis, tests and targeted reading provide different
forms of evidence. **This is a broad codebase audit, not a claim that every line
was manually reviewed or every execution path exercised.**

## Confirmed repairs

### Workspace and document authority

- Child-row policies allowed malformed quotation/order/purchase-order items and
  purchase payments to attach to protected parents or be independently shared.
  Parent visibility and author/current-administrator authority now govern linked
  reads and writes. Disposable database fixtures reproduce the old failures and
  prove the new boundaries.
- Public document RPCs exposed internal `shared_with` member IDs even on valid
  shared invoices. Their SECURITY DEFINER child joins also bypassed caller RLS
  for historical/admin-created foreign-workspace lines. Both active and legacy
  RPCs now strip ownership/sharing authority and require matching non-null parent
  and child organizations. Invoice/quote/PO output and synthetic receipt lines
  retain their customer-facing fields. Unassigned legacy lines fail closed until
  their ownership is repaired. Actual old definitions reproduce the leak; the
  twice-applied repair passes anonymous and private-token regression fixtures.
- Device rows exposed fingerprints/session IDs to ordinary or former members;
  registration could reassign a known fingerprint. Membership, own/admin reads
  and same-owner registration now protect the registry. Client install identity
  is account-specific while preserving the current owner's legacy/revoked row.
  Account/session changes cannot release another account's device or log it out.
- Canonical invitation fragments trusted editable profile email and could alter
  an existing member's role. They now use confirmed authentication identity,
  expiry, locking, role validation and preserved membership. This repairs fresh
  bootstrap fragments; the current workspace migration already had these rules.

### Atomic operations and concurrency

- Draft invoice, quotation and purchase-order headers/items now have a bounded
  invoker save RPC with one transaction, immutable ownership and allowed fields.
  MCP quotation column names were also corrected. Rejected lines or replacement
  saves roll back the header. This does not make posting, stock or payments atomic.
- Cloud payroll now commits the payslip and balanced salary posting together.
  Private durable period claims prevent duplicate execution without deleting
  historical duplicate records. Eight concurrent runs commit one payslip and one
  posting; failures roll back the complete operation. Missing RPC support fails
  explicitly rather than falling back to a partial save.
- Concurrent paid entitlement claims could consume two subscriptions while
  attaching only the last one to a workspace. Serialized claims now preserve the
  losing entitlement and the winning customer/subscription pair.
- Tool-job insertion now validates supported bounded pending work and reserves
  admission once. Clients cannot forge authoritative processing/output fields.
  Both Edge and Node workers finish only the exact claimed processing revision,
  so stale completion cannot overwrite cancellation, requeue or a newer claim.
- Independent MCP writers now allocate and persist records and their journal in
  one SQLite transaction. Corrupt collection/journal bytes fail closed and remain
  recoverable; a journal failure rolls back the collection write.

### Agent, endpoint and native boundaries

- Raw agent HTTP previously inherited model retries and repeated an uncertain
  approved POST four times. It now dispatches once, rejects redirects and checks
  Stop, actor/workspace and fresh permissions after async credential resolution,
  immediately before dispatch. Late response bodies after Stop are discarded.
- Managed Coin requests reject an account/cache-owner mismatch. Subscription
  polling retains its originating actor/workspace instead of adopting a later
  login. Empty retired Stripe configuration no longer prevents unrelated license
  actions from booting the endpoint; SDK initialization is action-specific.
- Email, invitation, checkout and video paths use actual streamed body bounds,
  object/action validation and safe errors. Credentialed requests reject
  redirects. Public checkout and lead admission use atomic bounded quotas; paid
  team allowances require real current membership. Saved lead state and genuine
  email acceptance are reported separately from successful delivery.
- Native storage/backups reject junction/symlink traversal and verify containment.
  Exports use atomic writes. Shell output is drained while retaining at most
  1 MiB per stream, avoiding unbounded buffering/deadlock. Windows shortcut paths
  are escaped as PowerShell literals and the helper remains hidden.
- MCP reminder tools no longer create approval codes that the paired-channel
  executor cannot safely accept; the user is directed to the bound approval flow.

### Financial accuracy and frontend reliability

- Bank reconciliation respects debit/credit direction, rejects malformed amounts
  and impossible numeric dates, supports escaped/newline CSV fields through the
  shared strict parser and rejects malformed truncated CSV. The import screen
  bounds files before buffering them. Legacy unsigned positive amounts retain
  their unknown-direction fallback; textual date formats are not certified as
  universally unambiguous.
- Receivable summaries use posted sales balances after partial payments and
  invalidate when payments change. Drafts and supplier documents do not inflate
  the customer balance. MCP reports also correct document discounts/VAT,
  cancelled/credit-note income and mixed-currency aggregation.
- A saved payslip retains its recorded salary/allowance/deduction/net values even
  if the employee salary later changes. Invalid payroll months cannot be issued,
  and stale employee/history loads cannot overwrite the current screen.
- Receipt editor loads are revision-guarded: a slow earlier selection cannot
  replace a later receipt, and a completed save cannot assign its ID to a newer
  draft. Failed public-link creation no longer claims that sharing succeeded.
- Invoice, quotation and receipt public links require a hosted cloud address;
  device/local/localhost links are rejected before publication. Private overdue
  invoices no longer receive a portal URL that the recipient cannot open.
- Malformed locally saved file metadata now raises a recoverable error instead
  of silently treating damaged data as a missing file and risking replacement.

Each repaired boundary has a regression or isolated execution fixture. Earlier
3 October membership, audit-log, billing, integration and channel repairs remain
in place and are not relabelled as new findings here.

## Verification ledger — initial audit snapshot

All commands ran against local files, generated fixtures or throwaway databases.
Focused counts overlap consolidated suites and are not additional unique tests.

| Check | Result | Evidence under `output/` |
| --- | --- | --- |
| Production TypeScript + Vite build | Passed | `full-audit-2026-10-04-build.log` |
| Full frontend Vitest rerun | 2,543 passed across 345 files, zero failed | `full-audit-2026-10-04-frontend-final.log` |
| All Edge tests | 215 passed, zero failed | `full-audit-2026-10-04-all-edge-tests.log` |
| Frozen Deno check of all Edge entry points | Passed | `full-audit-2026-10-04-edge-check.log` |
| Disposable PostgreSQL/RLS/atomicity/concurrency, including final portal fix | Passed | `full-audit-2026-10-04-database-final.log` |
| Disposable MFA/billing authority fixtures | Passed | `full-audit-2026-10-04-mfa-tests.log` |
| Disposable channel/draft/scheduled-write fixtures | Passed | `full-audit-2026-10-04-channel-tests.log` |
| Native Rust, locked/offline | 28 passed | `native-audit-2026-10-04-rust-tests.log` |
| WhatsApp bridge focused suite | 50 passed in five files | `wa-bridge-audit-2026-10-04-tests.log` |
| Real installed bridge media, no pairing | Passed | `full-audit-2026-10-04-bridge-media.log` |
| MCP build/SQLite smoke/17-tool stdio handshake | Passed | `mcp-audit-2026-10-04-tests.log` |
| Worker syntax + Node tests | Six passed | `full-audit-2026-10-04-worker-tests.log` |
| Schema drift checker synthetic regressions | Nine passed; no live catalog check | `full-audit-2026-10-04-schema-checker-tests.log` |
| Real Chromium conversion/PDF/CSP fixtures | Passed | `full-audit-2026-10-04-browser-tools.log` |
| ESLint | Zero errors; 522 warnings remain | `full-audit-2026-10-04-lint-final.log` |
| Route-bundle and release-recovery checks | Passed | `full-audit-2026-10-04-route-bundles.log`, `full-audit-2026-10-04-release-recovery.log` |
| Runtime npm audits: root, worker, MCP, bridge | Zero reported vulnerabilities | `full-audit-2026-10-04-*-audit.json` |

The first full frontend run started before the final transport patch was saved:
2,541 passed and two transport regressions failed against the earlier loaded
code. A fresh 50-test cross-transport run passed with no further source change;
the frozen-source rerun passed all 2,543 tests and is the authoritative result
for that initial snapshot. The completion report supersedes it for current source.

A redacted pattern scan examined 1,555 tracked and non-ignored untracked text
files below 2 MB for provider,
GitHub, AWS and PEM private-key signatures. Its single match is an explicit PEM
placeholder in deployment documentation. This is not a complete secret audit:
ignored files, Git history, short/opaque credentials and live secret stores were
not inspected. Evidence: `full-audit-2026-10-04-secret-patterns.json`.

## Follow-up status

The requested follow-up repairs are implemented in
[Audit gap completion](audit-gap-closure-2026-10-04.md). That report contains
the final consolidated verification and pending rollout requirements. The
earlier verification counts above remain evidence of the initial snapshot.

| Priority | Gap | Required next repair or verification |
| --- | --- | --- |
| Closed locally | Posting, payment, stock, advance, journal and order transactions | Operation-specific RPCs, durable replay identities, local atomic equivalents, failure injection and concurrency checks. Pending matched deployment. |
| Closed locally | Document-number races | Authoritative cloud/device/MCP reservations, normalized manual-number guards, bounded counters and preserved historical duplicates. |
| Closed locally | Incomplete canonical installer | Full empty-database installation, existing Auth-user provisioning, tracked repeat installation, explicit upgrades and runtime catalog verification. |
| Closed locally | Desktop/MCP cache conflicts | Complete read-set compare-and-set, cross-process tests, sync preservation and independent mutable record copies. |
| Closed locally | Lead/voucher/coupon setup | Atomic service-only setup and replay receipts; coupon failure rolls back the whole bundle. |
| Closed locally | Legacy Stripe invoice total parity | Shared line-aware totals and advances; real PostgreSQL partial/full, licence, replay, denial, rollback and concurrency checks. Public `pay_invoice` remains HTTP 410. Historical books still require reconciliation. |
| Closed locally | Development dependency advisory | Vulnerable generator chain removed, exact licensed CSS and application components retained; full root npm audit reports zero vulnerabilities. |
| P2 | Raw REST/import/sync business invariants | Own-row writes remain subject to RLS/module/MFA and triggers but do not exclusively enter the transactional dispatchers. Coordinate authority changes with import/sync and manual workflows; a blanket write revoke would break them. |
| P2 | Lint warnings, broad `any` usage, hook dependencies and very large UI/API files | The initial snapshot had 522 warnings; see the closure report for the final count. Resolve through bounded module/workflow reviews, without mechanical suppression or broad behavior-changing refactors. |
| Verification gap | Mobile runtime/physical devices, live gateway/RLS/storage/Realtime deployment | Validate matched deployment in a controlled environment, then real iOS/Android navigation, keyboard/swipes and offline recovery. This local audit does not prove the current website matches the source. |

The initial npm audit recorded six high-severity paths to the development-only
`braces` issue. The follow-up removes that chain and the full root npm audit now
passes. Native Rust advisory scanning was not performed. Local checks do not
constitute a claim that hosted CI or a live deployment ran successfully.

Other boundaries remain: legacy untagged local rows cannot be reliably assigned
to a workspace; native path checks do not protect against a hostile same-OS-user
process racing replacements; public limiter proxy/IP trust and distributed
flooding need deployed-gateway validation; unusually large reply threads need
performance testing. Public document projection preserves non-authority customer
columns; newly added columns need explicit privacy review rather than assuming
the JSON export is safe for every future field. Cancellation cannot prove that a request already dispatched
to an external provider was cancelled remotely. No Docker converter image or new
Android/iOS build was executed in this pass.

## Pending rollout requirements

Twelve new migrations are local and unpublished, mirrored into canonical fragments
where appropriate and documented in `supabase/MIGRATIONS.md`:

1. `supabase/2026-10-04-document-child-authority.sql`
2. `supabase/2026-10-04-tool-job-authority.sql`
3. `supabase/2026-10-04-atomic-document-save.sql`
4. `supabase/2026-10-04-workspace-device-authority.sql`
5. `supabase/2026-10-04-atomic-payroll.sql`
6. `supabase/2026-10-04-subscription-claim-serialization.sql`
7. `supabase/2026-10-04-public-document-privacy.sql`
8. `supabase/2026-10-04-document-number-authority.sql`
9. `supabase/2026-10-04-atomic-lead-setup.sql`
10. `supabase/2026-10-04-atomic-business-workflows.sql`
11. `supabase/2026-10-04-atomic-recurrence.sql`
12. `supabase/2026-10-04-stripe-invoice-total-parity.sql`

A future matched release must apply the documented database upgrades and matching
Edge handlers before relying on their RPCs in desktop/web/MCP clients. The Node
worker image must include `jobs.js`; its Dockerfile now uses the checked-in lock
and reproducible production install. CI now includes worker and MCP checks, and
the Edge test command discovers the complete functions tree. No rollout was
attempted as part of this audit.
