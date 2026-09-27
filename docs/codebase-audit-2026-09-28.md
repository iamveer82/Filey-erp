# Filey codebase audit — 28 September 2026

Release remains on hold. These changes belong to draft PR #19; no production deployment, customer-record edits, payments or messages were performed.

## Confirmed defects fixed

| Area | Failure | Change |
| --- | --- | --- |
| CRM edits | A stale editor could overwrite a newer save, including after a live refresh replaced the parent row. | Preserve the revision opened for editing and use the existing conditional update for saves, board moves and related-task toggles. A conflicting save retains the draft and reports that a refresh is needed. |
| External integrations | Retrying a failed response could repeat a completed connector action. | Function writes default to no retry. Only known read operations retry; email retains retries with its existing provider idempotency key. |
| Integration quotas | Counting past audit rows allowed simultaneous requests through the same remaining quota, and a failed count could fail open. | Reserve usage with the existing atomic database counter before calling the provider. Counter failures stop execution. |
| Bring-your-own integration keys | A failed key lookup could silently fall back to Filey's shared key. | Stop with a retryable settings error instead. |
| My Files uploads | The upload hook searched by filename after uploading and could move an older same-name file into the selected folder. | Set the folder on the new metadata row. This also removes an extra full-library request and separate move. |
| CSV import | Duplicate/empty headers and surplus cells could silently lose values; broken quoting was accepted. | Reject ambiguous input before importing and preserve literal property names safely. Existing valid quoted CSV remains supported. |
| Document children | Cloud child queries could stop at the server's row cap. | Fetch ordered, parent-filtered pages and reject a failed later page instead of returning an incomplete document. |
| Device management | Failed reads looked like empty lists; a failed release could be unhandled, and an unacknowledged deletion could look successful. | Check read/write acknowledgments, lock repeated actions, show actionable feedback and offer refresh. |
| Account/email wording | Internal schema/profile errors and deployment-variable instructions appeared in ordinary account screens. | Keep customer-facing connection/retry wording and the setup guide. |
| Email opt-outs | Repeated Enter presses could duplicate an add; failed removal had no handled feedback. | Lock pending changes, preserve the row on failure, and add an accessible email input label. |
| Custom-field drawer | Closing discarded unsaved changes; choice editing removed a comma before the next choice could be entered. | Confirm discard, retain the raw choice text, and prevent saving an unfinished new field accidentally. Failed saves retain the editable draft. |
| Desktop agent shell | A timeout stopped waiting but left the command running. | Terminate the process tree on timeout, report unconfirmed termination explicitly, hide helper windows and restrict the IPC entry to the bundled Filey window using the existing guard. |
| Windows shell quoting | C-runtime argument escaping broke quoted commands passed to `cmd.exe`. | Pass the already-authorized shell command with Windows' literal command-line API; a quoted PowerShell round-trip is included in the native tests. |

An unused Stripe helper import was removed. No dependency or parallel implementation was added.

## Review coverage

The pass combined source tracing, existing regression suites and new checks for the defects above. Areas reviewed included app/session gates, workspace switching, sync/recovery, cached reads, CRM CRUD/imports, document persistence and totals, files/attachments, billing/wallet/refunds, integration isolation, agent/WhatsApp controls, native command boundaries, and shared form controls.

This is a broad risk-focused audit, not a claim that every line or external provider workflow is fault-free. Existing tests include representative routes, local/cloud account isolation, financial transactions, invoice limits, permissions and sync failure recovery. Tests used generated data and disposable databases/browser contexts.

## Verification

- Frontend/application regression suite: **1,922 tests across 287 files passed**. The final custom-field adjustment was also checked separately (3 tests).
- Edge-function suite: **101 tests passed**, including the integration quota/key failure cases; modified handlers pass `deno check`.
- Production TypeScript/build and route-bundle checks passed. File converters remain separated from unrelated routes.
- Disposable PostgreSQL checks passed, including permissions, CRM custom columns, sync recovery/ownership, concurrent wallet reservations, refunds and idempotency. These were local database fixtures, not live customer queries.
- Chromium file-tool checks passed on rerun: real PDF worker text extraction/rendering, cancellation/recovery, sanitization, SVG/vector conversion and Arabic invoice output. The first run exceeded the fixture's 60-second timeout during cold bundling; it is recorded as a failed initial run, not omitted.
- Chromium and WebKit at 390px and 1440px passed the custom-field close/keep-editing/discard/remove interactions with no page errors or horizontal overflow. Prior checks on this draft also cover mobile invoice-preview geometry, sidebar swipes and checkbox states.
- WhatsApp media fixtures passed. Production dependency audits reported **zero known vulnerabilities** for the app and bridge at audit time; this is not a guarantee that the software has no vulnerabilities.
- Lint: **0 errors, 539 warnings**, down from 541. Existing warnings are mainly loose types and hook/refresh rules; they were not suppressed.
- Release-recovery guard and `git diff --check` passed. A working-tree scan for known provider-key prefixes found no literal key matches in the checked source paths.
- Windows native suite: **20 tests passed**, including storage/sync rollback, browser/computer boundaries, bridge session binding, quoted commands and termination before a delayed write. Initial attempts exposed a toolchain-path issue and the quoted-command failure; both were corrected before the passing run.

The command-quoting change follows Rust's documented [`CommandExt::raw_arg` behavior for `cmd.exe`](https://doc.rust-lang.org/std/os/windows/process/trait.CommandExt.html#tymethod.raw_arg). No extra runtime dependency was added.

## Release requirements and limits

- Apply the prepared CRM JSON-column migration in `supabase/2026-09-28-crm-custom-fields.sql` before releasing the CRM changes. It remains undeployed during the release hold.
- Deploy the updated integrations edge function with the existing `filey_take_rate_limit` RPC available, then smoke-test configured integrations using a test workspace.
- A real iPhone, a signed packaged desktop build and live WhatsApp/provider sessions still require release smoke tests. WebKit checks are useful but do not replace testing on physical iOS hardware.
- Shell termination uses native process-tree/group termination. Commands that deliberately detach must not be assumed stopped when Filey reports that termination could not be confirmed. macOS/Linux execution must be verified on their release runners.
- Existing lint warnings and large document-route bundles remain maintenance work; no broad formatting rewrite or speculative cache was introduced. Converter isolation is checked by the build's route-bundle guard.
- Browser local-storage replacement retains its existing rollback behavior but is not crash-atomic. Desktop snapshot replacement is transactional. No live local-to-cloud transfer was run against customer records in this audit.

Follow `docs/releases/v3.0.9-plan.md`. Wait for the user's explicit release command before merging, tagging, deploying production or publishing.
