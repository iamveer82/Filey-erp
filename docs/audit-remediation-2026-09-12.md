# Audit remediation

Implementation follows [the 20-finding audit](full-audit-2026-09-12.md).
Business records are not test fixtures. SQL migrations are staged in source;
local verification does not imply production deployment.

| Finding | Status | Verification |
| --- | --- | --- |
| F01 Shared-record permissions | Implemented; cloud deployment pending | Real PostgreSQL: 38 business tables, five identities, SELECT/UPDATE/DELETE, targeted shares, child rows, cross-org RPC, repeat migration |
| F02 Local IDs and sync conflicts | Implemented; cloud deployment and UI review pending | Random safe integer IDs preserve existing keys; transactional revision checks, durable conflict review; SQL stale-write/delete/retry checks and focused TS tests pass |
| F03 File transfer and sync completion | Implemented; installed-app transfer rehearsal pending | Failed uploads remain pending; immutable storage paths; native disk reader reused by transfer; cloud files cached before metadata; three file-transfer regression checks pass |
| F04 Data-directory move | Implemented; installed-app move/restart rehearsal pending | Native fixture verifies WAL snapshot, saved file copy, occupied/overlapping destination rejection and atomic pointer writes; source preserved |
| F05 Backup key recovery | Implemented; installed-app recovery rehearsal pending | Authenticated manifest and portable random recovery code; different-key restore, wrong-code/tamper rejection, key-store failures and truncated encryption checks pass |
| F06 Atomic restore | Implemented | Restores staged in a new directory; original data and backup preserved; startup reports failed activation; native collection + journal commits are transactional |
| F07 Scoped credentials | Implemented; UI review pending | OS vault per account/org; browser session memory; provider-bound chat/image keys; private secret references with echo redaction; Composio entity/connection isolation. Seven credential regressions, 36 AI/secret checks and 13 native checks pass |
| F08 WhatsApp media dependency | Implemented | sharp 0.35.4 in root and bridge; bridge dependency audit clear; five bridge QR/PDF command fixtures pass; real media fixture added |
| F09 Module permissions | Implemented; cloud deployment and UI review pending | Failed membership blocks access; direct routes, shared tools, desktop powers and cloud integration proxy gated; database tests cover hidden records, JSON bank settings, sharing and sync RPC. 18 access/native-entry frontend checks pass |
| F10 Supplier payables | Implemented | Reports age posted supplier bills after payments at frozen FX; PO commitments remain separate. 13 focused financial checks pass |
| F11 Marketing identity and currency | Implemented | Customer IDs survive renames; unique legacy company/name fallback; ambiguous matches excluded; frozen FX shared with Reports; 19 marketing/payables checks pass |
| F12 Durable messaging outbox | Implemented; actual paired delivery not exercised | Persist-before-send, attachment hash/version, provider IDs, cross-mode duplicate protection, Comms review; 31 outbox/agent/bridge checks plus 12 dialog checks and 13 native checks pass |
| F13 Invoice template picker | Implemented and browser-reviewed | Selected-template strip above invoice details; full gallery and preview retained; responsive header; six catalogue checks pass; at 1280 × 720 the customer and billing fields are visible with the template; 390px has no page overflow |
| F14 Mentions accessibility | Implemented and browser-reviewed | Labelled combobox, active option, portal outside scrolling feed, theme tokens, Unicode names and visible delete controls. Real browser fixture verified Arabic keyboard selection and unclipped, legible popups in both themes |
| F15 Release checks | Implemented; clean-machine installer/upgrade remains unverified | Frozen Windows install and Linux dependency resolution pass; Deno lock updated, 61 edge tests pass; six real Chromium file-tool fixtures pass; CI gates added for browser/edge/media/native. Vitest patched to 4.1.11; residual PPTX/image-size advisories documented |
| F16 Report exports | Implemented | Selected report exports posted invoices, exact low-stock/top-ten balance tables or financial statement rows; all-time/as-of scope and AED units explicit; six export/payables checks pass |
| F17 Performance | Implemented; packaged cold-load benchmark pending | Initial static JS reduced from 2,907,187 to 1,171,642 bytes before compression. Actual manifest checks keep unrelated converters out of initial/CRM/invoice routes. Lazy Settings preserves drafts; real PDF progress, cancellation, worker cleanup and resource limits verified |
| F18 International capability coverage | Implemented; broader statutory coverage remains explicit product work | In-app country matrix and settings link; Arabic customer/address/item/note through real invoice PDF exporter, visually reviewed; UAE/India/EU/Saudi limits documented without parity claims |
| F19 Integration status and diagnostics | Implemented | Automatic-computer guidance, explicit API-app counts, paginated owner-scoped connections, stale-response guards and Resend payer/readiness text. Redacted support summaries expose correlation IDs, never free-form messages or details |
| F20 Maintenance | Implemented; remaining warnings triaged separately | Durable bank/cheque saves retain drafts on failure; invoice payment load errors block posting; stable notification callbacks prevent repeated load effects; auth/AI/report hooks reviewed; obsolete audit script removed after repository reference check |

Native verification is now available using the installed x86-hosted x64 compiler:
`VsDevCmd.bat -arch=x64 -host_arch=x86`, then `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`.
The latest run passed 13 native checks, including the new storage and portable backup fixtures. No Build Tools repair was required.

The final full frontend suite passed **1,517 tests across 224 files**, with no
failures or pending tests. Legacy fixtures now use explicit IDs where needed;
permission, cancellation and lazy-loading fixtures reflect the updated flows.

## Final verification and limits

- Final automated checks passed: 1,517 frontend tests, 13 native tests, 61 frozen
  cloud-function tests, six real Chromium fixtures, integration-function type
  checking, the production TypeScript/Vite build and route-bundle checks.
- Business records were not edited, deleted, posted or used as test fixtures. The
  local invoice list still shows its original one paid invoice. The Settings draft
  used to check tab persistence was restored without saving.
- The browser fixture uses generated files in a separate temporary profile. It
  covers PDF worker text, canvas/image round trip, cancellation/recovery,
  sanitization, SVG conversion with lazy WASM tracing and actual Arabic invoice PDF output.
- Settings warm navigation took 3,296 ms in the development browser while checks
  ran; this includes control/IPC latency and is not a packaged-app benchmark.
- Native tests use the installed x86-hosted x64 compiler and passed all 13 cases.
  Frozen Deno tests passed all 61 cases; the integration function type-check passed.
- The Comms outbox persists invoice send attempts before transport, retains provider
  acceptance IDs and rejects ordinary duplicate attempts, even after a sent-status
  update. Generic file-send tools and manual external drafts are not a universal
  messaging delivery/retry service. Actual pairing and recipient delivery were not
  exercised, and no test messages were sent.
- Country coverage remains documents plus an AED ledger; native payroll, statutory
  filing and complete Odoo/Salesforce parity are not claimed. Arabic output was
  reviewed on a representative template, not every template/font combination.
- Cloud migrations are source changes, not production deployment. The three
  September 12 migrations and integration function must be deployed alongside the
  frontend update; follow supabase/MIGRATIONS.md. Release/upgrade, rollback,
  real-provider delivery, and cross-machine OS-vault recovery still need an
  installed-app rehearsal with disposable workspaces.
- Root dependency audit still reports the documented PptxGenJS/image-size chain.
  The isolated WhatsApp bridge dependency audit is clear. See
  pdf-dependency-review.md; do not downgrade the document exporter blindly.
- The obsolete scripts/audit-to-md.mjs had no maintained workflow or code callers;
  its only reference was the historical audit report. No live routes, agent-tool
  registration, migrations or business modules were removed.

The production TypeScript/Vite build and route-bundle check pass. The final lint
run has **0 errors, 540 warnings**, including 18 remaining hook warnings outside
the remediated auth/credentials, report-request counters and invoice payment flow.
The earlier audit baseline was 544 warnings / 30 hook warnings; this is targeted
maintenance, not a claim of a warning-free repository.

Composio connection management follows its [official account guide](https://docs.composio.dev/docs/auth-configuration/connected-accounts); pagination uses provider cursors and never silently displays a partial list.
