# Editor renewal review — 8 September 2026

This records the current editor, CRM, document and AI improvements, together with the limits of their verification. The source changes are prepared for review; this record does not certify a published update or an installed Windows release. The full test suite and production build passed; lint reports zero errors with existing warnings.

## Completed changes

| Area | Concrete result |
| --- | --- |
| Shared controls and dialogs | Editors use Filey's warm white/charcoal surfaces and default yellow accent, 40px pill actions, 40px fields with 8px corners, and 24px page headings. Save/Create uses the primary action; Cancel/Back uses the bordered secondary treatment. Shared dialogs manage focus and Escape. Search, repeated line inputs, uploads and icon actions have clearer accessible names. |
| Business forms | Reviewed create/edit paths use consistent fields, action placement, busy states and visible errors. Accounting posts the selected transaction date. Existing bank opening balances are explicitly read-only rather than offering an ineffective edit. Failed employee reads are distinguished from missing employees; failed invitations retain their draft. Team's default-room view no longer creates a room merely by opening it. |
| Document editing and preview | Shared desktop/mobile and bounded zoom controls replace divergent preview controls. Minimizing a preview retains the document needed for export; closing during resize releases the drag cursor. Declaration letters refuse to overwrite unreadable saved lists, preserve existing letters, and report PDF failures. Supplier/document forms guard repeated submission and retain drafts after failed saves. |
| Document tools | Input and option controls, selection states and dialogs were normalized, including signature drawing controls. Existing output handling propagates canceled/failed native saves, permits download retry, and clears stale output after input/tool changes. The browser coverage below concerns input workspaces, not every conversion engine. |
| Custom templates | Builder layouts honor their selected layout, font and hidden sections without changing document totals. Template persistence uses the active local/cloud account and organization; stale reads, failed writes and conflicting edits are reported. Designers stay open after save failures. Unowned legacy caches remain untouched and are not automatically displayed or migrated. Previewing a template does not select it until the explicit Use action. |
| Connected CRM | Companies, contacts, leads, deals, tasks, notes and activity share linked record forms and return navigation. Tables support saved sorting and visible columns; task due filters and Complete/Reopen actions use existing data operations. Saved views are isolated by account, workspace and local/cloud mode. Switching identity resets in-memory workspace state; unfinished Save-view prompts cannot write afterward. Section Insights remain in central Reports. |
| Overview and Reports | Overview charts use workspace data and respond to the selected period. Reports distinguish recorded invoice payments from independent receipt documents, avoiding a combined total without a reliable receipt link. |
| AI interface and tool validation | History, memory and approval dialogs use named controls; closing a pending approval denies that request. Starters prepare text for review instead of sending immediately. Ambiguous invoice/product/employee matches are rejected, with explicit IDs available. Stock/payroll numbers, attendance dates/statuses and linked CRM records are validated. Legacy CRM actions share form validation. Unreadable settings lists block destructive replacement, and bank totals stay separated by currency. Existing capability and approval gates remain in force. |
| Provider setup | Local Ollama/LM Studio endpoints support keyless loopback access and optional server tokens. Hosted presets expose user-key setup and provider limits. Changing provider origin clears the previous provider's key. Provider selection or a passing mocked connection test is not proof that a live account/model is available. |
| Workspace identity | Auth publishes the authenticated cache identity before child views consume it. Local sign-in/profile changes update the scope, and late cloud responses cannot restore a signed-out session. Template and CRM view caches use this identity rather than an anonymous device-wide cache. |

## Browser review and preservation boundaries

The lead agent's editor-renewal browser review used a separate QA tab/origin and QA fixtures, not user business records. Create/edit/preview panels were opened and canceled. This pass did not save, delete or send user business records, connect providers, enter keys, or change stored preferences. Automated mutation tests used isolated fixtures.

| Reviewed surface | Coverage and limit |
| --- | --- |
| ERP editors | Create/edit/preview panels across sales and purchase documents, receipts, stock/parties, people creation, accounting/bank/cheques, work, communication and integrations. The QA workspace had no employees, so employee-detail and payslip behavior was checked in isolated tests rather than a populated browser flow. This verifies observed behavior, not every possible data combination or provider output. |
| CRM | All seven new-record forms plus linked-record details/navigation were reviewed. Save/import/status behavior has isolated regression coverage; browser inspection did not alter existing CRM records. |
| Responsive layout | Invoice, Declaration Letter, template grid/full preview and Filey AI were checked at 390px width as well as the 1280px laptop view. Template cards remain separate; page width stays within the viewport. AI suggestions remain above the empty-chat composer. |
| Document tools | **88 document-tool input workspaces** were opened/reviewed. This is **not conversion certification** for all 88 tools, all supported file types, OCR accuracy, large files or native save dialogs. |
| Settings | All **12 panels exposed in the reviewed configuration**: Company Details, Account & Profile, AI Assistant, Apps & Modules, Appearance, Preferences, Desktop License, Notifications, Backup & Restore, Data & Storage, Activity Log and Diagnostics. Cloud-only Users & Roles, Billing and Security were not part of this 12-panel count. |
| Charts and Reports | Overview invoice/payment charts matched the QA fixtures, and the 30-day range updated. All seven Reports sections were reviewed. This does not certify every historical exchange-rate or reporting scenario. |
| Keyless reference rates | A live lookup returned **USD 272.29 for AED 1,000**, with provider date **8 September 2026**. This verifies that reference-rate action; it does not imply settlement rates or availability of other providers. |

## Twenty comparison and remaining gaps

The CRM organization draws on Twenty's [official repository](https://github.com/twentyhq/twenty) and its documented [views](https://docs.twenty.com/user-guide/views-pipelines/capabilities/filters-and-sorting) and [record pages](https://docs.twenty.com/user-guide/layout/capabilities/record-pages). Filey is not a full replica.

| Capability | Current Filey coverage | Remaining gap |
| --- | --- | --- |
| Custom objects and fields | Fixed connected ERP/CRM objects and validated forms | User-defined object/schema builder |
| Workflow builder | Existing agent actions, tasks and explicit approval controls | Visual trigger/condition/action workflow designer |
| Columns | Visibility and sorting saved with views | Drag reordering and interactive column resizing |
| Synced/shared views | Device-local views isolated by account and storage mode | Cloud synchronization and team-shared view permissions |
| Email/calendar synchronization | Explicit communication actions, links and calendar export | Connected mailbox/calendar synchronization and automatic CRM activity ingestion |

General inline/bulk CRM editing, customizable record layouts and an interactive CRM calendar also remain incomplete. See the [CRM workspace guide](crm-workspace.md) for the implemented surface.

## External services and release limits

Core local ERP/CRM does not require a paid CRM API subscription. Hosted AI, Resend, messaging/business channels and integrations require the user's own authorized account/keys or server configuration. **No shared credentials are bundled.** Provider quotas, sender authorization, hosting and usage charges still apply; a chat draft is not evidence that a PDF was attached or delivered. Local models require installation, suitable hardware and a running server. AI keys remain in the user's profile without application-level encryption. See [local AI setup](local-ai-providers.md), [invoice messaging](invoice-messaging.md) and [password recovery](password-recovery.md).

The two September 6 cloud migrations for international business and work items still require remote application and verification. A packaged installer, fresh install/upgrade, native dialogs, backup/restore and real cross-device sync are separate release checks. The outstanding `pptxgenjs`/`image-size` dependency findings remain open. These boundaries are recorded in the [desktop workspace update](desktop-workspace-update.md) and [PDF dependency review](pdf-dependency-review.md).

## Verification status

| Check | Status for this renewal |
| --- | --- |
| CRM saved-view/navigation follow-up | Passed: 11 tests across 3 files, plus the routed CRM smoke check. |
| AI record/CRM/employee validation | Passed: 64 focused tests across 6 files, including confirmation/capability checks. Counts overlap other subsets and must not be added together. |
| Auth workspace scope | Passed: 10 focused workspace-session tests, as reported by its owner. |
| Focused template/provider checks | 53 checks passed across two runs: 52 in the combined run; the tool smoke that timed out there passed in an isolated rerun in 807ms. |
| Browser editor review | Completed within the read-only scope and limits listed above. |
| Full automated suite | **Passed: 1,188 tests across 175 files in 91.14 seconds**, using `npm test -- --maxWorkers=4`. The subsequent AI empty-layout adjustment passed its 4 focused checks. |
| TypeScript and production build | **Passed: `npm run build` (TypeScript and Vite).** Vite retains warnings about modules imported both statically and dynamically. |
| Final lint | **Passed with 0 errors and 539 warnings.** Existing warnings remain; this is not a warning-free codebase. |
| Native installer, cloud migrations and live provider delivery | **Not validated by this pass.** |

## Compact invoice editor follow-up — September 8

Invoice and purchase-invoice creation now start with the compact template chooser, followed by customer/supplier, dates and items. Billing fields are always visible directly below the customer/company name inside Invoice details. E-invoice fields stay mounted in an expandable section, while branding and notes start collapsed. Tax rate and calculated totals remain visible beside the items. The main toolbar keeps Back, Preview, PDF and Save, with secondary actions in a keyboard-accessible More menu. The optional side preview starts minimized and remains mounted for export.

The template designer opens in a dialog, guards dismissal during template/letterhead saving and uses a native font selector to avoid a dropdown outside the modal's focus boundary. Item columns retain readable minimum widths on small screens. Pill buttons and the existing Filey theme are preserved.

Read-only browser checks covered 1280 × 720 and 390 × 844 layouts, disclosures, line options, live totals (2 × AED 120 + 5% = AED 252), action-menu keyboard navigation, full and side previews, and template font selection. No business records were saved, sent or deleted. Editor checks passed: 29 tests in four suites. Template follow-up checks passed: 27 tests in four suites; these subsets overlap and must not be added together. TypeScript/production build passed; changed-runtime lint reported 0 errors and 34 existing warnings.

## Settings redesign — September 8

All 15 panels now use shared divided sections, aligned labels and controls, responsive fields and pill actions. Horizontal navigation wraps on desktop and scrolls on narrow screens; URL selection, keyboard navigation and mounted drafts are preserved. Company assets and member lists are more compact, modules and notifications use flat rows, and AI providers use a grouped selector with advanced connection fields in a disclosure. The animated sidebar assistant remains intact.

Activity Log now reports load failures and offers Retry. Security no longer reports two-factor authentication as off after a failed status request; it shows an unavailable state and disables management until a successful retry. Both failure/retry paths have mocked regression checks.

Browser review covered every one of the 12 tabs available in the disconnected local edition at 1280 × 720 and 390 × 844. Controls fit the narrow viewport; the activity table retains its horizontal scroll. Light/dark shared surfaces and theme previews were checked using a separate disposable origin. AI disclosures and keyboard tab selection were exercised without provider requests. Cloud-only Users, Billing and Security branches were reviewed in code, with existing mocked editor/auth tests; live cloud billing, MFA enrollment and native desktop operations were not performed. Existing user tabs and drafts were preserved, and no user business records or saved preferences were changed.

Final verification: **1,193 tests passed across 177 files**, TypeScript/production build passed, and Settings runtime lint reported **0 errors and 30 existing warnings**. Vite retains its existing chunk-size and mixed-import warnings. No dependencies were added.
