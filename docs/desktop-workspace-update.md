# Desktop workspace update — 7 September 2026

This records the desktop workspace source update and its verification. Browser checks used the real application with a separate local QA origin, without changing the user's business records. No new installer, cloud migration or update has been published by this pass. The remaining release checks below are explicit boundaries, not completed work.

## Completed changes

| Area | Current behavior |
| --- | --- |
| Shared design | Warm white and charcoal surfaces, default Filey yellow, 40px pill actions, 40px fields with 8px corners, and 24px page titles. Shared controls, accessible labels, focus behavior and modal handling keep sections consistent. Existing print templates retain their paper styling. |
| CRM | Companies, contacts, leads, deals, tasks, notes and activity use connected workspace records. Table/board actions, linked record editing, CSV validation and export failures have explicit handling. Connections remain in Integrations; CRM Reports opens central Reports. |
| Overview and Reports | Overview charts use workspace data. Section Insights live in Reports, with period controls, accessible data tables and CSV export. Empty datasets stay empty; failures can be retried. Monetary reporting distinguishes document currency and saved exchange rates. |
| Payment receipts | Existing edits are saved before marking a receipt paid. Status/share failures are visible. Native-currency totals are grouped separately, and CSV includes numeric amounts plus an explicit currency column. Printing waits for the selected receipt to load. |
| Quotations | Sending saves the latest edits and generates the PDF before dispatch. A PDF failure prevents an incomplete email. Busy controls prevent repeated submission while that operation is running. |
| PDF tools | Native save cancellation propagates to callers. Generated output remains available for download retry without repeating conversion. Switching tools resets files/options, and changing inputs clears stale output. Downloads are awaited and failures are reported. |
| Payslips | Canceling the PDF save does not post payroll. Concurrent submissions are guarded. Failed payroll-history reads block recording/download until history is successfully refreshed. Backend payroll checks and transaction coverage are included in the broader verification. |
| Lists and exports | Inventory searches the promised category field. Main list searches and repeated document-line fields have accessible names. CSV save failures are handled across all live callers instead of becoming unhandled rejections or immediate success notices. |
| Workspace reliability | Local/cloud switching preserves account boundaries and keeps their stores distinct. Failed or stale reads and failed writes have regression coverage; explicit transfer and sync remain separate actions. |
| Local transactions | Invoice finalization and posted edits stage the invoice, lines, order, stock, movement records, account balances and ledger together. Payment changes and payroll also roll back on failed local commits. Native SQLite read failures are distinguished from missing records. Power-loss recovery and cloud transaction boundaries still need packaged/database validation. |
| Bank balances | Bank account rows show their original currency. Summary balances are grouped by currency rather than adding unlike amounts or applying an invented exchange rate. |
| Free services and user keys | Ollama and LM Studio accept keyless loopback connections, optional local tokens and model discovery. OpenRouter free models and Groq have explicit user-key setup and quota guidance. Changing provider origin clears the previous provider's key. Existing Composio/Zernio user keys, keyless reference rates, manual messaging links and calendar export remain available. No shared keys or automatic paid fallback are bundled. |
| Authentication | Signed-out desktop navigation stays on sign-in rather than the old marketing page. Password entry and recovery flows retain their prior fixes; recovery-provider delivery has separate setup and verification requirements. |

Detailed behavior is maintained in [CRM workspace](crm-workspace.md), [reporting update](reporting-update.md), [storage and design update](storage-design-update.md), [password recovery](password-recovery.md), [invoice messaging](invoice-messaging.md), and [local AI and provider keys](local-ai-providers.md).

## Free local behavior

Core local ERP/CRM and local invoicing remain free, without the hosted free-plan invoice cap. Existing paid Freedom entitlements remain separate and are not downgraded. Local records save to the device; cloud records use the connected account's hosted store. Opening a different storage mode does not itself copy or synchronize business records.

Local mode currently links the device through an initial online account sign-in. Remembered offline password access depends on a previous successful password sign-in; a completely disconnected first-run account signup is not implemented. Fresh-device activation, offline restart and upgrades still need packaged-desktop verification.

Free local software does not make every external service free. Resend email needs server-side configuration and an authorized sender; messaging/business channels, Telegram bots, hosted integrations and external AI require their own credentials or connection setup. Provider quotas, hosting, messaging and model usage may have separate costs. Native draft/share actions still require the user or an explicitly configured delivery workflow to complete sending. This pass does not certify real recipient delivery across providers.

AI keys remain in the user's browser/desktop profile without application-level encryption; the settings explain this. The local model catalogue and connection checks have regression coverage, but no models were installed or live hosted keys tested during this pass. Users choose and run a suitable local model, or supply their own supported provider key. No existing provider configuration or credentials were changed during the browser review.

## Pending cloud migrations

These two additive migrations remain **pending remote application and validation**:

| Migration | Required before |
| --- | --- |
| `supabase/2026-09-06-international-business.sql` | Saving or transferring the new country-tagged business records to cloud. |
| `supabase/2026-09-06-work-items.sql` | Enabling cloud Projects/Helpdesk and transferring records containing `work_items`. |

The previous management API attempt for the work-items migration returned HTTP 403 / code 1010. Local collections do not require these SQL migrations. Apply through an authorized database connection, then verify owner/organization isolation, linked-record checks, and local/cloud transfer behavior before describing those cloud features as released. Do not embed management or service-role credentials in the client.

Country-aware forms and document snapshots are a foundation, not full national localization. The ledger remains AED, and national filings, country-specific payroll and statutory certification remain incomplete. See [international business](international-business.md) and [platform readiness](platform-readiness.md).

## Cleanup and dependency status

The runtime import graph and explicit entry-point review identified 39 obsolete files, including superseded tests. They were archived outside the repository before removal so the prior uncommitted work remains recoverable. Runtime aliases, worker entry points and the test setup were reviewed separately rather than treated as dead code merely because a basic import graph did not reach them.

Four unused dependencies were removed: `@chenglou/pretext`, `@fontsource/plus-jakarta-sans`, `@radix-ui/react-dropdown-menu`, and `cmdk`. Existing installed primitives serve the retained UI.

PDF.js was upgraded to 6.3.289 with its matching official legacy worker for desktop WebView compatibility. Real parser/render/export tests and the browser's saved-invoice preview passed. The dependency audit still reports **two affected packages: `pptxgenjs` and its transitive `image-size` dependency**. These findings remain open. Filey's current PowerPoint path passes only newly encoded canvas PNGs, not uploaded ICNS/JXL/HEIF images, and the browser dependency maps `image-size` out. See the [PDF dependency review](pdf-dependency-review.md) for the traced exposure and upstream advisory links; this is not a clean security-audit result.

## Verification and remaining release checks

- Final broad automated run: **160 test files, 1,092 tests passed** (`npm test -- --reporter=dot`). A real PDF worker/font initialization initially exceeded the default five-second timeout under concurrent build load; only that integration check's startup allowance was raised to 15 seconds, with all parsing/pixel/output assertions retained. The complete rerun passed. This is not a promise that every provider, tool or native environment has been exercised.
- The page/output subset passed **55 tests** across the page smoke suite and document-action, PDF-tool-action and PDF-download regressions. It covers latest receipt edits, separate currencies, CSV errors, required quote attachments, canceled saves, retry without reconversion, tool-state reset and payroll-history failure recovery.
- `npm run build` passed, including TypeScript and the production Vite build. `npx eslint src --quiet` passed with no errors; pre-existing warnings remain. The native SQLite regression passed after compiling the full Rust library. Test email, messaging, native-save and cloud boundaries use isolated mocks where appropriate; no recipient delivery is implied by those tests.
- The VTracer and `ag-psd` bundling warnings were traced against emitted production assets. Filey explicitly passes the emitted WASM URL instead of using the package's missing default filename; the emitted asset completed a real raster-to-SVG conversion. The emitted browser PSD chunk parsed a valid image to its expected pixel values. Large optional document-tool chunks and existing mixed static/dynamic import warnings remain performance work, rather than failed builds.
- A reusable route/action audit is available at `scripts/audit-routes.mjs`, with generated output in `output/erp-page-action-audit.json`. It records the 31 registered module routes, explicit JSX routes and page handlers. Static reachability supports review; it is not a guarantee that every action is correct.
- **Browser coverage:** all 33 sidebar destinations, all 12 settings sections and all seven report tabs loaded in the local QA workspace. Filey AI's workspace and setup were inspected; no hosted inference or external message delivery was performed. The normal local app at port 1420 correctly showed only sign-in while signed out.
- Before the user's later read-only instruction, disposable records were created only on port 16422: a customer, one stock item, a linked invoice, a deal and a task. Customer and deal changes persisted across reloads; the deal moved from Qualification to Proposal. Two items at AED 120 plus 5% tax produced AED 252, reduced stock from 10 to 8 and created the completed order. Recording AED 252 payment cleared the balance, posted the cash/receivable ledger legs and appeared in Overview and Reports. Accounting showed AED 240 revenue, AED 160 cost and AED 80 profit. The generated invoice PDF rendered correctly in My Files. No further business records were changed after the read-only instruction.
- Invoice payment charts now use actual payment dates and the parent invoice's saved exchange rate. Independently authored receipt documents remain a separate series because they have no stable payment link; summing the two sources could count one payment twice.
- Desktop (1280px) and narrow (390px) layouts were visually inspected in light/dark themes. The mobile drawer isolated background focus, Escape restored focus to Open menu, and CRM forms fit without page overflow. Themes were restored after inspection. Resend's configuration check showed a clear sign-in requirement and sent no email. The public keyless exchange-rate service returned a live result without saving it to any document.
- The last read-only Settings review found a controlled color picker with no change handler. It now preserves native edits until its existing save-on-blur step; the rebuilt Preferences screen loaded without new console errors. No color or other stored preference was changed during that verification.
- QA development uses its own dependency cache to avoid interference with the normal app server. A temporary stale-React error after a dependency optimization was resolved by isolating that cache and reloading; Accounting and the full route review then passed.
- **Native installer: not validated.** Fresh install, signed packaging, existing-user upgrade, offline restart, native file dialogs, real backup/restore, cross-device sync and rollback remain release checks. A passing web build or mocked save test does not validate the installed Windows application.
- Apply and verify the two pending cloud migrations and resolve the remaining dependency findings before declaring the corresponding release work complete.
