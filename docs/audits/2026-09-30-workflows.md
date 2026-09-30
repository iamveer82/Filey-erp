# Workflow coverage — 30 September 2026

Scope: module navigation, existing business workflows, in-app documentation and email-template persistence. Tools, AI/Teams chat and UAE e-invoice validation have separate reviews in this batch. This record distinguishes synthetic execution from source review; it does not certify every production integration.

## Findings fixed

- Browser was registered and routed but omitted from the sidebar groups. It is now reachable under Tools. A regression renders every registered module and verifies its link.
- Email-template writes previously closed the editor and claimed success before `app_settings` was saved. Creation, starters, duplication and deletion now wait for the durable write; failed writes preserve the original list/cache and open draft. Pending writes block duplicate actions and editing.
- A failed template read no longer appears as an empty account that can be overwritten. Cached records remain visible, mutation is blocked and Try again reloads them. Stored JSON is validated before rendering. Account/mode isolation and pending-response guards remain.
- A refresh started before a template save cannot overwrite the saved cache, and a pending save cannot report into the next account or mode. A failed background refresh is retryable inside the open editor without discarding its draft. Deletion uses the latest list after its confirmation, preserving records loaded while the dialog was open.
- Help instructions incorrectly said switching never transfers records and described the browser as a separate window available on the web. They now describe the actual transfer-before-switch and Windows browser-panel behavior.
- Added guides for directories, orders, payment receipts, banking/cheques, delivery/declarations, communication history/templates and reminders/marketing. Invoice help distinguishes local checks/free XML from actual provider submission.
- Mobile documentation uses the existing searchable SelectMenu. Empty search feedback is available on both mobile and desktop; whitespace around search text is ignored.
- AI setup help now accurately explains the account/workspace-scoped OS credential store on desktop and memory-only browser keys that must be entered again after reload. This was verified from source; no key value or provider request was inspected.

## Section map

`api.ts` routes database-backed APIs to the active local/cloud client. Naming a cloud table below confirms code connectivity, not a successful live production request. Local synthetic tests never use customer records.

| Section | Data boundary / active store | User output | Evidence in this review |
| --- | --- | --- | --- |
| Overview | `erp`, `billing`, `fin`, `crm`, `receipts` | Snapshot/chart data and linked actions | Source reviewed; parent batch owns chart checks |
| Reports | `useReportsData`, `fin`, record insights | Period summaries, chart rows and CSV | Financial statements, payment reporting and record-insight tests ran |
| Inventory | `erp.products`, stock movements; `pos` | Product records, movements, reorder drafts | Local business-workflow tests ran, including decimal adjustment and single receiving |
| Orders | `erp.orders`, order items, products/customers | Saved order and fulfilment status | Source reviewed; business-dialog tests ran |
| Invoicing / Purchase Invoices | `billing`, invoice headers/items/payments | Saved documents, PDFs and supported XML | Parent owns editor/e-invoice review; local purchase-invoice/accounting tests ran here |
| Quoting | `quotes`, quotation headers/items | Saved quote and converted invoice | Source reviewed; local business tests ran, including failed replacement retaining original lines |
| CRM | `crmWorkspace`, CRM object APIs | Linked companies, contacts, leads, deals and tasks | CRM conversion/workflow tests ran |
| Customers / Suppliers | `crm`, `suppliers`, linked documents | Party directory, detail links, statements | Source reviewed; linked-party business tests ran |
| Follow-ups | `followups`, party directories; scoped notes | Due reminders, completed state and notes | Source reviewed; no real notification sent |
| Marketing | CRM records, campaigns, optional lookup services | Ranked contacts and campaign drafts | Live refresh/editor-preservation tests ran with mocks; campaign sending not exercised |
| Purchase | `fin.expenses`, `ExpenseEntry` | Saved expense, purchase summary and ledger effects | Expense/business-dialog and accounting tests ran |
| Purchase Orders | `pos`, PO items/payments, products | Draft, received stock and payable records | Local receiving/accounting tests ran |
| Accounting | `fin`, accounts/transactions/expenses | Journal, trial balance and statements | Double-entry and financial-statement tests ran |
| Bank Accounts | `tools.settings`, `bank_accounts` plus scoped cache; `fin` for reconciliation | Payment instructions and reconciled ledger markers | Durable-save failure/live-refresh and reconciliation tests ran |
| Cheques | `tools.settings`, `cheque_register` plus scoped cache | Issued/received cheque register and status | Durable-save failure/live-refresh tests ran |
| Payment Receipts | `receipts`, company/customer data | Saved receipt, preview, PDF and status | Source reviewed; parent owns document-action suite; reporting tests ran |
| Declaration Letter | `tools.settings`, `declaration_letters` | Saved editable declaration and PDF | Source reviewed; invalid stored lists are rejected in the implementation |
| People | `hr`, employees/attendance/payroll | Employee records, payroll, payslip/WPS output | HR summary and business-dialog tests ran; real payroll/export delivery not performed |
| Projects / Helpdesk | `work`, `work_items`; customer/invoice links | Saved record, tasks, time entries, revisioned updates and CSV | Local persistence/stale-edit and UI failed-save/lifecycle tests ran |
| Comms log | `emailLog`, `callLog`, `MessageOutbox` | Outbound history, call records, queued WhatsApp jobs | Source reviewed; no email/call/WhatsApp message sent |
| Delivery | `challans`, `delivery_challans` setting | Saved delivery/GRN/return record and PDF | Local challan round-trip tests ran; source reviewed |
| Email Templates | `tools.setSetting`, `email_templates` plus scoped cache | Saved subject/body templates | New durable-save/retry/repeated-click/read-failure tests and scope tests ran |
| My Files | `files.ts`, local blobs/files or cloud user-files storage | File previews, downloads, folders and sharing | Offline-file and rejected-read tests ran; no live upload/share performed |
| Settings | Existing lazy account/company/data/appearance panels | Saved preferences, data switching, backups and billing entry points | Routing/source reviewed; auth, customer storage and billing not mutated |
| Integrations | Configured provider adapters and desktop bridge | Connection status and optional external actions | Source reviewed; live provider acceptance/delivery not verified |
| Browser / Filey AI / Team / Tools | Dedicated agents in this batch | Browser panel, agent/chat results and tool files | Navigation covered here; functional review reported separately |
| Help / Documentation | `KnowledgeCenter.GUIDES`; local diagnostic export | Searchable workflow instructions and section links | Guide route/search/picker tests ran; actual UI inspected at 390 × 844 and default desktop size |

## Executed checks

- **37 tests passed in 3 focused files:** workspace navigation, live sections and KnowledgeCenter. The live-section suite covers bank/cheque/template write failure, invalid stored template JSON, account separation, stale load/save responses, open-editor retry and delayed deletion.
- **69 tests passed in 16 additional files:** local business workflows, work items/UI, CRM sales, purchasing/accounting, supplier invoices, payment reporting, financial statements, double-entry, HR summary, record insights, challans, reconciliation and offline-file/read-error handling. A first run of the newly written guide test had an ambiguous duplicate-button query; it was corrected and all 4 guide tests subsequently passed.
- Browser checks on localhost opened existing documentation only. The mobile picker filtered and selected the receipt guide. Screenshots are in `output/workflow-guides-desktop.png` and `output/workflow-guides-mobile.png`; the temporary viewport was reset and test tab closed.
- No customer record, real message, subscription/payment, production migration, secret or deployment was changed by this review. The parent batch owns complete typecheck/build and full-suite results.

## Remaining integration boundaries

- Bank and cheque entries are records, not banking transactions. Receipt PDFs do not charge a card or transfer money.
- Email API acceptance and WhatsApp queue acceptance are not recipient-delivery evidence. Live delivery needs its configured provider/paired desktop account and a permitted real recipient.
- Cloud/local transfer is implemented and documented, but this pass did not transfer a real customer workspace. Production schemas, session renewal and sync conflicts need their dedicated integration checks.
- Windows native browsing cannot be exercised by the mobile/web runtime. Model capability, platform restrictions, CAPTCHA and user sign-in still apply.
- E-invoice local validation/XML output is separate from submission through an accredited provider. No legal-compliance or provider-certification guarantee is made here.
- Country-aware document labels are not full national tax filing, split-GST or statutory payroll implementations. The underlying ledger remains AED.
- Templates remain a small list in one setting. Simultaneous multi-device edits require per-template rows and revision checks to prevent competing whole-list writes; that schema redesign is not included in this pass.
