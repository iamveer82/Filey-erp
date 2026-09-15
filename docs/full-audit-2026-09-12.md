# Filey ERP / CRM audit — 12 September 2026

Audit of the local working tree on `codex/desktop-workspace-update`, based on commit `08e81f4` / version 2.11.0, including the uncommitted WhatsApp and automatic computer-access fixes. Those fixes have not been published by this audit.

## Assessment

The interface now has a coherent Filey identity: restrained surfaces, pill buttons, horizontal settings tabs, an animated sidebar assistant and useful empty states. Preserve that foundation. Another wholesale frontend rewrite would delay the more important work.

The highest priorities are permission enforcement, file recovery and synchronization. Several code paths can leave records and attachments inconsistent even though the normal screens and unit tests pass.

**20 findings: 0 P0, 10 P1, 10 P2.** P1 means fix before relying on the affected workflow in a wider release; it does not mean that a production incident was observed. P2 means a functional, usability or release-process improvement. No P3 cosmetic inventory is included.

The source findings below are confirmed implementation problems or explicitly identified gaps. Actual exploitation, data loss, message delivery and production database policy state were not tested against customer records.

## Scope and evidence

- Opened all **32 registered modules**, plus Help Center and Documentation in the local browser.
- Reviewed all **9 CRM views**, all **15 Settings tabs**, and all **7 Reports tabs**.
- Opened and dismissed invoice, declaration and new-deal creation interfaces without saving.
- Checked representative layouts at **1280 × 720** and **390 × 844**. Restored the viewport afterward.
- Read the shared data, authentication, sync, migration, native storage, permission, messaging and agent paths, with targeted callers and tests.
- Inspected root and WhatsApp bridge dependency audits and CI/release workflows.
- Did not edit business records, send messages, submit invoices, change passwords, switch accounts/storage modes, pair WhatsApp, or run a restore.
- This is broad workflow and architecture coverage, not a claim that every line of all 533 TypeScript/TSX files or every possible button/input combination received manual verification.
- Dark-theme and Arabic/Hindi completeness findings are based on source inspection; preferences were not changed for this audit.

### Verification

| Check | Result |
| --- | --- |
| Frontend/service suite | **1,481 tests passed, 212 files**, 0 failed, 0 pending; bounded to two workers; about 189 seconds |
| ESLint | **0 errors, 544 warnings**, including 30 hook dependency warnings |
| Webhook suite with checked-in Deno lockfile | **Blocked:** frozen lockfile is out of date |
| Webhook diagnostic using a copy of the lockfile in the temporary directory | **61 passed, 0 failed**; repository lockfile unchanged |
| Production TypeScript/Vite build | **Passed**; existing large-chunk, mixed static/dynamic import, browser-externalized `util`, and vtracer WASM resolution warnings remain |
| Native Rust tests in this audit | Could not compile: installed MSVC toolset points to a missing `cl.exe`, including after loading the VS developer environment. This is a local toolchain blocker, not a proven Rust code failure. |
| Previous native release evidence | Release notes report six Rust tests passed; not treated as a fresh native pass here |
| Root npm audit | 4 dependency entries: 2 high (`image-size` / `pptxgenjs`), 2 moderate (`vitest` / `@vitest/mocker`) |
| WhatsApp sidecar npm audit | 1 high entry: `sharp` |
| Local browser | Reviewed screens rendered; no app error messages in the final browser error-log check |
| Live cloud / installed-app delivery / restore | Not exercised in this audit |

The earlier unbounded test run suffered PDF timeouts under resource contention. The bounded full run passed. Use predictable worker limits for local validation instead of interpreting that contention as a confirmed PDF defect.

## Priority findings

### F01 — P1: Shared-record policies grant more than read access

**Where:** [supabase/schema.sql:982](C:/Users/iamvi/Documents/GitHub/Filey-erp/supabase/schema.sql:982), [supabase/schema.sql:1049](C:/Users/iamvi/Documents/GitHub/Filey-erp/supabase/schema.sql:1049), [supabase/2026-08-26-invoice-team-sharing.sql:23](C:/Users/iamvi/Documents/GitHub/Filey-erp/supabase/2026-08-26-invoice-team-sharing.sql:23).

**Evidence and impact:** The documented model says another member's shared records are read-only. The common policy uses `FOR ALL` with the shared-record predicate in `USING`; that also admits DELETE for matching rows, subject to table grants and other constraints. The invoice-specific policy puts shared and targeted recipients in both `USING` and `WITH CHECK`, so visibility is also sufficient for ordinary invoice updates. A guarded `share_invoice` RPC does not restrict direct table updates.

**Fix:** Separate SELECT from INSERT/UPDATE/DELETE policies. Limit modifications to the author or authorized administrator, and prevent ownership/sharing changes through alternate paths.

**Acceptance:** In an isolated database, test author, administrator, shared reader, targeted reader, unrelated member and unrelated organization for SELECT, PATCH and DELETE. Verify the deployed policy catalogue separately. Do not use customer records for this check.

This conclusion follows the checked-in policies and PostgreSQL's command-specific policy semantics; it is not a claim that the hosted database was penetrated. [PostgreSQL row-security documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

### F02 — P1: Two devices can allocate the same business-record ID

**Where:** [src/lib/localdb.ts:299](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/localdb.ts:299), [src/lib/localdb.ts:628](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/localdb.ts:628), [src/lib/sync.ts:8](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/sync.ts:8), [src/lib/sync.ts:126](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/sync.ts:126).

**Evidence and impact:** New numeric IDs are `max(existing IDs) + 1`. Sync upserts on `id`. Two offline copies of the same account can independently create different records with the same ID; when both reconnect, an upsert can replace the other record instead of creating a second one. Existing-record edits also generally use last-writer-wins without a conflict review.

**Fix:** Use globally unique IDs, or an explicit server/device ID allocation and foreign-key remapping scheme. Add revision checks for conflicting updates. Do not migrate IDs casually across linked invoices, stock and payments.

**Acceptance:** Two disposable device stores create records from the same snapshot, edit the same existing record, then sync in both orders. Both new records survive, links remain correct, and stale updates are surfaced.

### F03 — P1: Attachment transfer is incomplete and can report false success

**Where:** [src/lib/sync.ts:136](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/sync.ts:136), [src/lib/sync.ts:323](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/sync.ts:323), [src/lib/sync.ts:374](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/sync.ts:374), [src/lib/migrate.ts:206](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/migrate.ts:206), [src/lib/localdb.ts:899](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/localdb.ts:899).

**Evidence and impact:**

- Automatic uploads do not inspect Storage's returned `error`; thrown errors and missing bytes are also swallowed.
- The collection journal can then be committed and sync marked done.
- Explicit local-to-cloud migration reads only legacy `fileblob:` base64 values, although current desktop uploads write encrypted files to disk.
- Automatic cloud-to-local pulls deliberately skip file metadata/assets.

A document may exist in one workspace while its PDF is missing in the other. Retrying can do nothing after the metadata's dirty flag has been cleared.

**Fix:** Reuse `readBlobBytes` for every upload path. Track attachment success separately, retain failures for retry, and implement an explicit download/cache policy. Show record-sync and file-sync status separately.

**Acceptance:** Test native disk files, legacy files, missing files, returned upload errors, connection loss, retries and a second device. “Synced” must mean the promised files can open there.

### F04 — P1: Changing the data directory leaves saved files behind

**Where:** [src-tauri/src/modules/storage.rs:47](C:/Users/iamvi/Documents/GitHub/Filey-erp/src-tauri/src/modules/storage.rs:47), [src-tauri/src/modules/storage.rs:85](C:/Users/iamvi/Documents/GitHub/Filey-erp/src-tauri/src/modules/storage.rs:85), [src/pages/settings/DataModePanel.tsx:307](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/settings/DataModePanel.tsx:307).

**Evidence and impact:** `set_data_dir` copies only `filey-erp.db` and immediately changes the directory pointer. File reads resolve under the new directory's `files/`, which was never copied. The database connection remains on the original database until restart. The destination can also already contain a database.

**Fix:** Stage a consistent database snapshot and the matching file tree, validate the destination, then switch the pointer only after successful verification. Serialize this with writes and retain the original workspace for recovery.

**Acceptance:** Move a disposable workspace with PDFs, reopen it, and compare every attachment. An existing destination or an interrupted copy must leave the original workspace usable.

### F05 — P1: “Full” backups do not carry recoverable file-encryption keys

**Where:** [src-tauri/src/modules/storage.rs:118](C:/Users/iamvi/Documents/GitHub/Filey-erp/src-tauri/src/modules/storage.rs:118), [src-tauri/src/modules/storage.rs:120](C:/Users/iamvi/Documents/GitHub/Filey-erp/src-tauri/src/modules/storage.rs:120), [src-tauri/src/modules/storage.rs:266](C:/Users/iamvi/Documents/GitHub/Filey-erp/src-tauri/src/modules/storage.rs:266).

**Evidence and impact:** File blobs use an OS-keyring key. Full backup copies the database and encrypted file tree but not a portable, protected recovery mechanism for that key. Restoring after an OS reinstall or on another computer can recover metadata while leaving files undecryptable. Additionally, `file_key()` generates a replacement key on any keyring read error, rather than distinguishing “not found” from temporary access failure.

**Fix:** Define a recovery format that includes a password-protected/wrapped file key, or another explicit portable recovery method. Never replace an established key on an arbitrary keyring error. Document what the backup contains; AI state and credentials in browser storage are also outside the database/files backup.

**Acceptance:** Restore on a clean OS account with no original keyring entry and open saved PDFs. Simulate keyring access failure without losing access to existing files.

### F06 — P1: Restore can replace files before validating and replacing the database

**Where:** [src-tauri/src/modules/storage.rs:299](C:/Users/iamvi/Documents/GitHub/Filey-erp/src-tauri/src/modules/storage.rs:299), [src-tauri/src/modules/storage.rs:320](C:/Users/iamvi/Documents/GitHub/Filey-erp/src-tauri/src/modules/storage.rs:320).

**Evidence and impact:** Full restore deletes/replaces the live files first and queues the database for the next startup. It checks database-file existence, not integrity. Startup ignores the result of the database copy and clears the pending marker anyway. Disk failure, an invalid backup or an interrupted restart can leave a mixed workspace and erase the retry signal.

**Fix:** Validate and stage the entire restore, preserve a rollback copy, and commit database and file-tree activation together at startup. Surface failures and keep recovery information until success. Validate source/destination relationships.

**Acceptance:** Interrupt each phase; use an invalid database, unreadable source and full destination. The app must either retain the old workspace or complete the verified restore.

### F07 — P1: Secrets are not consistently encrypted or scoped to the signed-in account

**Where:** [src/lib/secretStore.ts:4](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/secretStore.ts:4), [src/lib/ai.ts:35](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/ai.ts:35), [src/lib/composio.ts:54](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/composio.ts:54), [src-tauri/src/modules/sync.rs:15](C:/Users/iamvi/Documents/GitHub/Filey-erp/src-tauri/src/modules/sync.rs:15), [src-tauri/src/modules/composio.rs:19](C:/Users/iamvi/Documents/GitHub/Filey-erp/src-tauri/src/modules/composio.rs:19).

**Evidence and impact:** General secrets and AI configuration use global plaintext localStorage keys. Desktop Composio credentials use a global `kv_cache` value, and `cache_get` returns it to the frontend. The SQLite build uses ordinary bundled SQLite, not an encrypted database. Comments describing this credential as encrypted and never returned to the WebView therefore overstate the implementation.

The same browser profile or desktop installation can retain these credentials across account changes. This differs from chats/memory, which already have account/organization/storage scoping.

**Fix:** Scope credential references by account and organization, put desktop values in the existing OS keyring, keep cloud secrets server-side, and expose status rather than raw keys where possible. Make device-wide credentials an explicit choice. Migrate legacy values without silently attributing them to another account.

**Acceptance:** Account A stores a dummy key; B signs in on the same installation and cannot list, read or use it. Logs, exports and normal chat history contain no raw key.

### F08 — P1: The separate WhatsApp package has a vulnerable image dependency

**Where:** [tools/wa-bridge/package-lock.json:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/tools/wa-bridge/package-lock.json:1), [tools/wa-bridge/delivery.mjs:16](C:/Users/iamvi/Documents/GitHub/Filey-erp/tools/wa-bridge/delivery.mjs:16); fresh sidecar `npm audit`.

**Evidence and impact:** Auditing only the root package misses a high-severity `sharp <0.35.4` finding in the sidecar. Baileys dynamically loads sharp for media preparation. The upstream advisory concerns processing untrusted input and describes particularly serious conditions on glibc-based Linux; this is not evidence of a working Windows exploit in Filey.

**Fix:** Resolve a compatible patched sidecar dependency, rebuild distributed sidecars, and test image thumbnails and PDF sends. Include the sidecar in dependency checks.

**Acceptance:** Confirm the resolved package and distributed binary dependencies, clear the advisory or document an independently verified mitigation, and pass bridge/media checks. [Sharp maintainer advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c).

### F09 — P1: Module restrictions are primarily navigation restrictions

**Where:** [src/lib/modules.tsx:56](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/modules.tsx:56), [src/App.tsx:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/App.tsx:1), [src/pages/AgentChat.tsx:484](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/AgentChat.tsx:484), [src/lib/aiTools.ts:5053](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/aiTools.ts:5053).

**Evidence and impact:** A failed membership lookup falls back to unrestricted modules. Core modules stay enabled. Detail routes and the agent/data APIs do not consistently enforce the same module allowlist. In chat, `isOwner: !!scope` means an authenticated workspace user, not an organization administrator. That distinction is reasonable for distinguishing an app user from an external messaging customer, but it must not stand in for staff authorization.

Row ownership/organization RLS still exists; this is not evidence that unrelated organizations can read each other's records. It means hiding Accounting or People is not a complete staff-access policy.

**Fix:** Define explicit business permissions and enforce them in cloud/RPC and native/shared tool entry points, with matching frontend affordances. Fail closed for unresolved membership. Keep agent owner-context and organization-admin permission separate.

**Acceptance:** A restricted employee cannot retrieve or mutate a forbidden module through a URL, API, AI tool or background action.

### F10 — P1: Supplier “Payables” report is based on purchase orders, not supplier bills

**Where:** [src/pages/reports/SuppliersTab.tsx:24](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/reports/SuppliersTab.tsx:24), [src/pages/reports/SuppliersTab.tsx:68](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/reports/SuppliersTab.tsx:68), [src/pages/reports/useReportsData.ts:360](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/reports/useReportsData.ts:360).

**Evidence and impact:** The displayed Open Payables and aging charts consume `poList` and PO payments, using the PO expected date. Purchase invoices can create payables without any PO, so these reports can show zero while the ledger contains an unpaid supplier bill. Conversely, an unreceived sent PO appears as an amount owed.

**Fix:** Report posted purchase-invoice balances and their due dates as payables. Keep open PO commitments as a separately named operational report, with reconciled payment links.

**Acceptance:** An unpaid bill without a PO appears in payables; an unreceived order stays in commitments. Partial payments and foreign currencies agree with the ledger.

### F11 — P2: Marketing loses customer history and does not normalize currencies

**Where:** [src/lib/marketing.ts:46](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/marketing.ts:46), [src/lib/marketing.ts:60](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/marketing.ts:60), [src/pages/Marketing.tsx:55](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/Marketing.tsx:55).

**Evidence and impact:** Invoice aggregation keys on `customer_name`, while customer matching keys on `customer.name`; the stable customer ID and company name are ignored. The local audit showed an invoiced customer reported as having no trading history when the two names differed. Amounts are also summed directly without the reporting FX normalization used elsewhere.

**Fix:** Match stable IDs first, use a careful legacy fallback only where necessary, and reuse `reportMoney`/saved document rates. Keep contact completeness separate from commercial value.

**Acceptance:** Different person/company names and a renamed customer preserve history. Mixed-currency invoices produce the same consolidated value as Reports.

### F12 — P2: WhatsApp sending needs a durable outbox and reconciled history

**Where:** [src/components/DocumentMessageDialog.tsx:32](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/components/DocumentMessageDialog.tsx:32), [src/lib/waBridge.ts:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/waBridge.ts:1), [src/lib/waLog.ts:22](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/waLog.ts:22).

**Evidence and impact:** Duplicate prevention is mainly per-dialog state. The rolling local log is capped at 200 entries and can silently fail to persist. Sending APIs return void rather than preserving a provider message ID for reconciliation. Reopening a dialog or restarting after a timeout does not provide a reliable delivery/retry state. The Communications page also does not present WhatsApp as part of a unified history.

**Fix:** Save an outbound job before transmission with document ID/version, recipient, attachment hash, attempt ID and provider message ID. Distinguish queued, accepted, failed and unknown. Reconcile before retrying an unknown send.

**Acceptance:** Simulate restart before and after provider acceptance. A user can see what happened and cannot accidentally double-send through an ordinary retry. Actual delivery still needs a paired test account and authorized recipient.

### F13 — P2: Invoice template selection consumes the working area

**Where:** [src/pages/Invoicing.tsx:2518](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/Invoicing.tsx:2518), [src/pages/Invoicing.tsx:3846](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/Invoicing.tsx:3846), [src/components/DocTemplateGallery.tsx:128](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/components/DocTemplateGallery.tsx:128).

**Evidence and impact:** At 1280 × 720 the initial four previews occupy about 500 vertical pixels, pushing customer details below the first screen. At 390px width, the header's two action buttons squeeze “Choose a document layout” into a narrow column and visually crowd it. The four previews form a long two-column block before users reach billing details.

**Fix:** Keep templates at the top, as requested, but make the selected/default view a compact strip with an expandable gallery. Stack the header actions below its text at narrow widths. Use the existing pill buttons and shared components. Standardize “PDF” versus “Download PDF” across document editors.

**Acceptance:** On a small laptop the user can see the chosen template and customer fields together. At 390px there is no crowded header text or unnecessary gallery-height barrier.

**UI pass:** `$impeccable adapt`, then `$impeccable distill`.

### F14 — P2: Team mentions need accessible input/popup states and theme tokens

**Where:** [src/components/MentionInput.tsx:108](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/components/MentionInput.tsx:108), [src/components/MentionInput.tsx:127](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/components/MentionInput.tsx:127), [src/components/CompanyMessages.tsx:97](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/components/CompanyMessages.tsx:97).

**Evidence and impact:** The message input relies on placeholder text, and the mention picker does not expose combobox/listbox relationships or the active option. The popup uses a fixed white background with theme-dependent text. Delete controls appear only on group hover. These patterns make keyboard, screen-reader and dark-theme use less predictable.

**Fix:** Add a durable accessible label, appropriate expanded/controls/active-option semantics, theme surface tokens, and visible keyboard-focus actions. Keep existing keyboard selection behavior.

**Acceptance:** Navigate and choose a mention using only a keyboard and screen reader; the popup remains legible in both themes. Check WCAG 1.3.1, 2.1.1 and 4.1.2 during the fix; this audit is not a conformance certification.

**UI pass:** `$impeccable harden`.

### F15 — P2: The release checks do not cover the highest-risk runtime paths

**Where:** [.github/workflows/ci.yml:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/.github/workflows/ci.yml:1), [.github/workflows/rls.yml:9](C:/Users/iamvi/Documents/GitHub/Filey-erp/.github/workflows/rls.yml:9), [vitest.config.ts:9](C:/Users/iamvi/Documents/GitHub/Filey-erp/vitest.config.ts:9), [src/components/PdfToolbox.audit.test.ts:43](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/components/PdfToolbox.audit.test.ts:43), [deno.lock:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/deno.lock:1).

**Evidence and impact:** Vitest excludes the Supabase directory. The frozen Deno run currently fails due to lockfile drift; the 61 tests pass with a temporary updated copy. RLS CI triggers only for `schema.sql` and its test script, missing many dated migration files. The PDF audit skips browser-only engines and interactive studios internally, so “0 pending tests” does not mean all 88 tools ran end to end. Native tests could not run on this machine because the compiler binary is missing.

**Fix:** Refresh the Deno lockfile in a dedicated change and gate its tests. Trigger RLS tests on migrations and test read/update/delete separately. Add a small real-browser/native fixture matrix for file tools, restore, account changes and sync. Make configured native compilation reproducible.

**Acceptance:** A migration-only PR runs the security checks; frozen installs work; mandatory native/browser scenarios produce explicit pass/fail evidence instead of implicit skips.

### F16 — P2: Report export does not export the selected report

**Where:** [src/pages/reports/Reports.tsx:34](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/reports/Reports.tsx:34).

**Evidence and impact:** Every non-Insights tab's Export CSV writes the same seven summary metrics, independent of the selected report. Exporting Financial does not export the displayed profit-and-loss/balance-sheet rows; exporting Inventory does not export its stock table.

**Fix:** Export the active report's rows, date window and currency, or label the existing action “Export workspace summary” and add report-specific exports.

**Acceptance:** A CSV opened outside Filey matches the report the user selected, including its filters and units.

**UI pass:** `$impeccable clarify`.

### F17 — P2: Large assets and eager imports need measured optimization

**Where:** [src/lib/pdfTools.ts:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/pdfTools.ts:1), [src/modules/registry.tsx:4](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/modules/registry.tsx:4), [src/pages/settings/index.tsx:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/settings/index.tsx:1); production asset inventory.

**Evidence and impact:** The inspected build includes approximately 2.86 MiB HEIC code, 1.26 MiB PDF worker, 1.24 MiB PDF chunk, 0.54 MiB main JS and 0.56 MiB main CSS before compression. Many are separate/lazy chunks, so these numbers must not be added together and called the initial download. The first Settings navigation in the dev preview remained in its loader through two short checks, then rendered successfully.

**Fix:** Measure cold route loads in the packaged app, keep heavy converters loaded only when selected, and trim generated CSS/assets based on actual usage. Add progress/cancellation for expensive conversions. Avoid speculative memoization or another framework rewrite.

**Acceptance:** Record cold/warm timings on a modest machine with representative large files; verify that an ordinary invoice/CRM session does not download or initialize unrelated converter engines.

**UI pass:** `$impeccable optimize`.

### F18 — P2: International and competitive coverage needs honest, explicit boundaries

**Where:** [docs/international-business.md:37](C:/Users/iamvi/Documents/GitHub/Filey-erp/docs/international-business.md:37), [src/lib/i18n.tsx:34](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/i18n.tsx:34), [docs/platform-readiness.md:38](C:/Users/iamvi/Documents/GitHub/Filey-erp/docs/platform-readiness.md:38).

**Evidence and impact:** Country-aware document fields exist, but the ledger remains AED. Payroll/filings are incomplete across jurisdictions. Translation falls back to English, and many working screens still contain direct English strings. Project/ticket owners are labels rather than a full team-assignment workflow. These are capability gaps, not proof that existing UAE workflows are broken.

**Fix:** Publish a country/platform capability matrix; complete one jurisdiction's end-to-end accounting workflow at a time with appropriate validation. Then add team assignment, duplicate merging, multiple warehouses and deeper CRM automation according to real customer demand.

**Acceptance:** Each supported country states the available documents, currencies, tax handling, payroll and filing limits. Arabic forms and PDF outputs receive a real RTL review. Do not describe current breadth as complete Odoo/Salesforce parity.

**UI pass:** `$impeccable clarify` and `$impeccable adapt`.

### F19 — P2: Integration guidance and diagnostics are not fully aligned with behavior

**Where:** [src/pages/WorkspaceBrowser.tsx:190](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/WorkspaceBrowser.tsx:190), [src/pages/Integrations.tsx:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/Integrations.tsx:1), [src/lib/workServices.ts:104](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/workServices.ts:104), [src/lib/waLog.ts:22](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/waLog.ts:22).

**Evidence and impact:** Browser still instructs users to enable temporary computer access manually, despite the new automatic per-task flow. Integration counts are not a complete statement of native pairing/provider readiness. Diagnostics and messaging history are bounded local logs rather than durable support/audit records.

**Fix:** Update the remaining copy, show readiness per service (desktop unavailable / needs account / ready / error), identify which provider pays, and provide a redacted support export with correlation IDs. Preserve the distinction between opening a website and connecting its API.

**Acceptance:** The same connection state and next step appears in Integrations, Filey AI and invoice sharing; no screen sends users to a removed enable control.

**UI pass:** `$impeccable clarify`.

### F20 — P2: Maintenance debt remains visible in warnings and audit tooling

**Where:** [scripts/audit-to-md.mjs:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/scripts/audit-to-md.mjs:1), [src/lib/api.ts:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/api.ts:1), [src/lib/aiTools.ts:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/lib/aiTools.ts:1), [src/pages/Invoicing.tsx:1](C:/Users/iamvi/Documents/GitHub/Filey-erp/src/pages/Invoicing.tsx:1); lint report.

**Evidence and impact:** ESLint has 544 warnings, including 30 hook dependency warnings. Several shared modules and editors are very large. The old audit-to-markdown script reads an obsolete session-output path. Those conditions make stale state and misleading audit evidence easier to overlook.

**Fix:** Triage warnings around auth, scope changes, sync and document saves first. Remove the obsolete script after confirming no maintained workflow uses it. Remove unreachable source only after checking imports, lazy routes, Tauri command registration, migrations and string-based agent tools.

**Acceptance:** Changed critical paths have no unreviewed hook warnings, audit tooling runs from the repository, and each deletion has reachability evidence. A lint warning or old filename alone is not permission to delete a live feature.

## UI health score

These are provisional implementation-review scores, not a security grade or WCAG certification.

| Dimension | Score / 4 | Basis |
| --- | --- | --- |
| Accessibility | 3 | Most inspected controls have names; CRM dialog closes with Escape. Mention input/popup and hover-only actions need work. |
| Performance | 2 | Route splitting exists; converter assets are large and real-device cold-load benchmarks are missing. |
| Responsive design | 3 | Sampled shell/CRM/Tools/Settings fit 390px without page-level horizontal overflow; invoice picker header and height need refinement. |
| Theming | 3 | Shared tokens and chart styling are established; remaining fixed surfaces such as the mention popup need correction. |
| Product design consistency | 3 | Coherent pill controls and restrained layout; oversized template gallery and inconsistent action copy add friction. |
| **Total** | **14 / 20** | **Good foundation; address the weak dimensions.** |

**Product anti-pattern verdict:** Pass on the overall visual direction. The main problem is workflow friction and inconsistent edge states, not a generic visual identity. Keep the user's animated sidebar assistant, Filey colors and horizontal settings layout. Do not replace them to satisfy a generic design trend.

## Section coverage and next work

“Rendered” means the visible local screen loaded. It does not certify creating, deleting, sending or posting production records.

| Section | Observed / source-reviewed | Next meaningful work |
| --- | --- | --- |
| Overview | Nonzero invoice/customer/chart data rendered | Keep shared reporting normalization; verify cross-device refresh after F02/F03 |
| Reports | All seven tabs rendered | Correct payable source, selected-report export and period definitions |
| Orders | Existing order and statuses rendered | Multi-device creation/conflict tests |
| Invoicing / Purchase Invoices | Lists and invoice editor rendered; top templates and billing details present | Compact picker; reconcile bills/payments; native PDF/send checks |
| Quoting | Empty list rendered; conversion code/tests already exist | Preserve transactional conversion and retry behavior |
| CRM | Nine views and new-deal form reviewed | Server permissions, stable relationships, assignment, duplicate merging |
| Customers / Suppliers | Directories rendered | Stable links and correctly named balances; avoid divergent totals |
| Follow-ups | Reminder/note inputs rendered | Test restart/due notifications and keyboard note workflows with disposable data |
| Marketing | Ranking displayed a history mismatch | F11; keep enrichment optional and provenance visible |
| Purchase / Purchase Orders | Expense/PO screens rendered | Receiving/payment reconciliation across local/cloud |
| Inventory | Stock record and reorder state rendered | Concurrent receives/sales, transfers and eventual warehouse depth |
| People | Payroll/attendance entry screen rendered | Country-specific validation and staff permissions |
| Accounting | Existing journal and balances rendered | Closing controls, reconciliations and permission checks before broader claims |
| Payment Receipts | Empty list rendered | Link payment events to receipt documents without double counting |
| Declaration | Compact editor, editable title and preview rendered | Keep consistent actions; verify long/multipage and RTL output |
| Cheques / Bank Accounts | Empty register/account screens rendered | Reconciliation and currency-isolation scenarios |
| Projects / Helpdesk | Both lifecycles rendered | Real assignments/permissions, support inbox and SLA workflows |
| Team | Local channel/composer rendered | F14; real two-user delivery remains untested |
| Communications | Email/call history screen rendered | Durable, unified email/WhatsApp history |
| Tools | Gallery and covers rendered; code/tests reviewed | Real-browser outputs for skipped engines; size limits/cancellation |
| My Files | Existing file metadata rendered | F03–F06 before expanding storage claims |
| Delivery | Assignment/list screen rendered | End-to-end order/driver/stock workflow on test records |
| Email Templates | Existing templates rendered | Preview substitutions and actual authorized email delivery |
| Settings | All 15 tabs reviewed | Data protection first; clarify capability/readiness states |
| Integrations | Built-in QR setup and browser-only limitation verified | Durable outbox, sidecar dependency update and paired-device tests |
| Browser / Filey AI | Desktop limitation and AI setup state rendered | Update automatic-access copy; native cancel/restart/authorization scenarios |
| Help / Documentation | Both knowledge surfaces rendered | Keep guides aligned with verified release/platform capability |

## Free services and bring-your-own-key model

The current architecture already supports useful free/local paths. It does not need bundled private API keys.

| Capability | Current path | What remains |
| --- | --- | --- |
| AI | Downloaded models through Ollama/LM Studio; hosted provider presets and BYOK | Model readiness checks and quality benchmarks using realistic tasks |
| WhatsApp | Desktop QR bridge; browser/manual sharing alternatives | One-time pairing, durable retries/history, provider restrictions, installed-app QA |
| SMS | Compose/share a message through the user's messaging app | No implemented universal free carrier-delivery service; a SIM gateway would be a separate feature with user carrier costs |
| Email / recovery | Supabase Auth recovery with Resend SMTP; server-side transactional email | Verify actual configured delivery, domain status and quota handling with a test recipient |
| Public work data | Keyless public-source helpers and exchange rates | Cache age, attribution, offline/error states |
| Telegram / social | User-owned conversations, browser windows and optional provider/bot setup | Clearly separate direct user actions from hosted automation and its requirements |

Provider accounts, quotas, hardware, model licenses and delivery costs remain external constraints. Do not search for or ship other people's private keys. A missing hosted key should guide the user to a local or BYOK option, not create a dead button.

## What to retain

- Account/organization-scoped caches, chat/memory storage and stale-workspace guards.
- Password recovery's isolated, nonpersistent Supabase client and rate-limit handling.
- Explicit local/cloud switching that validates identity and does not silently copy records.
- Shared money calculations and saved document FX rates already used in main reports.
- Transactional quotation conversion and existing duplicate-conversion protections.
- Distinct document previews, compact declaration workflow, tool covers and shared pill controls.
- Current QR setup fix and automatic computer-session lifecycle, including Stop and selected approval mode.
- The large passing regression suite. Add tests at the uncovered failure boundaries rather than rewriting working modules.

## Recommended order

1. **Protect records and access:** F01–F09. Use isolated fixtures for policy, two-device sync, move/restore and credential-scope tests.
2. **Correct business outputs:** F10–F12 and F16. Payables, customer history and send-state reliability directly affect decisions and customer communications.
3. **Strengthen release evidence:** F15 and F17. Frozen dependency installs, separate package audits, actual browser-tool outputs and clean-device native tests.
4. **Finish product polish:** F13, F14, F18–F20. Preserve the established design and improve the small set of proven rough edges.

For the UI portion: `$impeccable harden` → `$impeccable adapt` → `$impeccable clarify` → `$impeccable optimize` → `$impeccable polish`.

These can be addressed individually or in batches. Re-run `$impeccable audit` after the UI fixes. The first implementation batch should be storage/sync/permissions, not additional integrations or another visual rewrite.

## Release limits

No fixes from this audit were applied to the app, no release was published, and no business records were changed. Only this report was added; the prior working changes were preserved. Actual cloud policy state, fresh-device upgrade/rollback, cross-machine encrypted restore, paired WhatsApp delivery and end-to-end email recovery still need dedicated operational verification.

Existing dependency context: the PptxGenJS browser route feeds generated PNGs and maps `image-size` out of the browser build; its root high-severity entries are not proven exploitable through the traced PDF-to-PPTX route. Retain the documented mitigation and reassess when that route changes. [docs/pdf-dependency-review.md:13](C:/Users/iamvi/Documents/GitHub/Filey-erp/docs/pdf-dependency-review.md:13). The separate Vitest development-server advisory should also be patched, without describing it as a shipped desktop vulnerability. [Vitest maintainer advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).
