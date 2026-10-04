# Filey system improvement pass — 3 October 2026

This pass reviews shared controls, business workflows, local/cloud boundaries,
background reminders, and desktop/hosted AI access. It fixes reproducible defects
and uses synthetic records and mocked providers. It does not certify every path
or change production accounts. Source changes remain local; version 3.0.10 and
the user's release hold are unchanged.

## Fixed gaps

| Area | Verified defect | Result |
| --- | --- | --- |
| Orders | A failed or delayed read could retain another order's customer and lines; inventory refresh could reset edits. | Clear failed loads, reject stale responses, offer Retry, and preserve current edits during product refresh. |
| Inventory | Fractional counts were truncated and a partial retry could repeat successful adjustments. | Validate and preserve physical counts; remove only confirmed rows from the pending count sheet. |
| Stocktake persistence | A saved cloud delta could be applied again after its response was lost; quantity and movement history were separate writes. | One absolute-count operation commits stock, movement, and a scoped request receipt together. Repeats confirm the receipt; changed book stock requires review. Local storage uses the existing transaction primitive. |
| Team chat | Switching conversations remounted the feed and removed its pending-send lock. | Keep send state with the conversation, clear only a confirmed sent draft, and retain failures for retry. |
| CRM | Local lead conversion created separate records through a changing client, with compensating deletes instead of the available transaction. | Convert lead, company, contact, and deal in one workspace-bound transaction; scope in-flight deduplication. |
| Cloud cache | Staff with unrestricted modules could receive an administrator's older cached private rows after a role downgrade. | Non-admin reads use fresh RLS checks instead of persistent admin snapshots. Strict fresh inventory reads never fall back to cached rows. |
| Legacy outbox | Temporary account initialization scope could replay unattributed or old-workspace operations. | Verify the authenticated account and current organization before replay; preserve unmatched and malformed legacy entries for recovery. |
| Reminders | Device-wide storage exposed another account's reminders; a delayed sweep could overwrite reminders added, changed, or cancelled during delivery. | Use existing account/workspace storage, fence asynchronous delivery, serialize sweeps, and merge only unchanged processed reminders. Preserve unreadable data. |
| Background agent | Throttles were global and workspace changes during a task could route its output incorrectly. | Scope throttles and check the original owner before sending or updating state. |
| Research credentials | Jina configuration and its spending key were device-global. | Scope configuration and use the existing OS credential vault or session memory. Quarantine unattributed desktop credentials. |
| AI business context | A cached brief could bypass newly revoked module access. | Check current module access and partition memoized briefs by access as well as account/workspace. |
| Hosted agent | Identical mutation calls in model rounds could execute twice; lost insert responses encouraged blind retries. | Reuse successful/uncertain receipts within the task and stop unconfirmed writes for reconciliation. New user tasks and changed inputs remain independent. |
| Hosted context | Owner-only history/memory queries could inject another company's information after a workspace switch. | Scope memories and history to the organization; exclude ambiguous legacy history and recheck access around asynchronous work. |
| AI financial reads | Hosted summaries used simple quantity × price arithmetic despite custom line amounts, formulas, discounts, tax, and rounding. | Share the existing pure invoice arithmetic with the web/desktop code and keep currency totals separate. |
| Inline editing | A live refresh replaced the original row revision; a pending save could discard a second editor; Enter could submit a containing form. | Save against the opened record, block overwrites of a changed live value, keep one active pending save, skip unchanged writes, and preserve failed drafts with visible Retry/Cancel controls. Accounting tables use stable record IDs. |
| Dialog lifecycle | Replacing a prompt or confirmation left the first caller unresolved and retained an old draft. | Resolve replaced or unmounted requests safely, reset the current prompt, and avoid stacking incompatible dialogs. Agent approvals use the same safe cancellation behavior. |
| Agent approvals | A replaced approval reused the old buttons; a stale gesture or callback could affect the new action. | Give each request its own dialog identity and ignore settlement from replaced requests. The current action requires a fresh decision. |
| AI navigation | The new Letters section was omitted from the agent's page list. | Expose the registered route in the tool schema and description, and check the destination's current module permission before navigation. |
| Quick views | Custom overlays lacked shared focus trapping and nested Escape behavior; narrow invoice tables overflowed. | Use the existing accessible dialog, restore focus, retain zero values, wrap metadata, and stack line details on mobile. |
| Dates and controls | A portaled calendar could modify a disabled fieldset; switches had undersized tap targets and notification navigation depended on a mouse. | Respect inherited disabled state, retain invalid-date feedback, provide 44px switch targets, and use keyboard-reachable notification links. Table controls explicitly avoid submitting forms. |

## Validation

Focused tests cover failure/retry, lost acknowledgement, concurrent operations,
workspace changes, role revocation, disabled calendars, dialog focus, and actual
hosted model-loop behavior. The stocktake SQL fixture runs against disposable
PostgreSQL, including simultaneous requests, rollback, RLS, module denial, and
repeatable migration checks. No real WhatsApp, Telegram, or paid model calls are
used in these tests.

Browser checks use the real shared components and synthetic invoice records at
320px, 390px, and 1280px. Light and dark quick views fit without horizontal page
overflow; failed inline edits retain their draft, visible Retry saves it after
reconnection, and an invalid typed date keeps the last valid date. This does not
replace physical iPhone testing.

The final full app run passed **2,438/2,438 tests across 339 files**. Earlier runs
caught the missing Letters navigation entry and duplicated navigation schema
text. Both were corrected without increasing the existing 15,000-byte model
tool-request limit; the initial payload is 14,974 bytes. Approval regressions
also verify that stale requests cannot trigger a replacement action.

The final TypeScript/production build and route bundle checks passed. The complete
frozen Deno endpoint suite passed **168/168**. The full disposable PostgreSQL
runner passed, including eight simultaneous stocktake requests producing one
adjustment and one movement. Final repository-wide ESLint reports **0 errors and 524
warnings**; style and hook warnings remain visible. Generated sidecar/native
vendor artifacts are excluded from source lint, matching the existing treatment
of other generated assets. The final diff whitespace check passed.

## Dependency review

The installed production dependency audit reports **zero advisories** on this
date. The complete development dependency audit reports six affected dependency
nodes from one `braces` advisory through the shadcn CLI's dependency tree. The
[reviewed advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no
patched release. No unsafe downgrade or audit suppression was applied. This
development-tool issue remains open; it is not evidence that runtime or business
logic is vulnerability-free.

## Schema readiness

The Packaging Lists (2026-10-01), Letters (2026-10-03, including typography and
visibility validation), and stocktake reliability (2026-10-03) cloud migrations
were applied to `voyrjqgaypiylwskkwpr` in one transaction on 3 October 2026.
A fourth migration,
[document-setting uniqueness](../supabase/2026-10-03-document-setting-uniqueness.sql),
was applied in a separate corrective transaction. The earlier checker missed
the legacy unconditional `app_settings_user_id_key_key` index, which could block
the same user's documents across workspaces. The correction removes that global
constraint while preserving workspace uniqueness and the partial index for
regular settings; existing rows are unchanged. The strengthened checker
reproduced the pre-fix failure. Its final live catalog readback passed:
**88 tables, 1,155 columns, 85 functions, and zero issues**. It verified 45 sync
tables' revisions, RLS and publication, current RPCs/columns, the latest
Letter/stocktake/access function definitions, scoped
uniqueness without the legacy global index, receipt permissions and the
validation trigger. Evidence is recorded in
`output/cloud-schema-2026-10-03.json` and
`output/cloud-schema-check-2026-10-03.log`, with the pre-correction snapshot in
`output/cloud-schema-before-uniqueness-2026-10-03.json`. **9 Node regressions and
the expanded disposable PostgreSQL suite passed**, including cross-workspace
documents for the same user, unchanged rows and repeated migration runs. No
business records were changed and no stocktake or document RPC was invoked
during the live schema updates.

The local schema already supports these features: desktop collections use
SQLite `kv_cache(key,value,updated_at)`, with Packaging Lists and Letters in
`localdb:app_settings` and device-only receipts in
`localdb:local_stocktake_requests`. New collections are created on their first
save; no SQLite column migration, `user_version` change, or record rewrite is
needed. The default Windows store is
`%APPDATA%\com.iamvi.filey-erp\filey-erp.db`, unless `data_dir.txt` selects another
folder. Read-only inspection confirmed compatibility; the customer store was
not modified. **51 local tests and 20 disposable SQLite checks passed**, covering
older issued snapshots, typography flags, durable blobs, receipt retries,
preservation of existing data, and repeatable startup migration checks.

## Before any release

Cloud schema prerequisites are verified. App, hosted edge handler, WhatsApp
sidecar, web, and desktop publishing remain on hold. Once authorized, deploy
the reviewed hosted channel function and rebuild/package the changed sidecar.
The new stocktake client deliberately does not fall back to replaying an unsafe
delta against an older
schema. Verify physical mobile behavior and an explicitly authorized paired-device
messaging round trip separately. No app or handler deployment, publication,
release, or version bump accompanied the schema update.
