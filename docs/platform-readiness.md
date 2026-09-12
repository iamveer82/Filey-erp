# Filey local business platform

Updated 6 September 2026. This records implementation scope and release gaps, not a claim of complete Odoo or Salesforce parity.

## Product direction

Core local ERP/CRM is free. Paid Freedom licenses retain their existing signed, device-bound benefits and price; no existing customer is downgraded. Local invoices no longer have the hosted free-plan invoice cap. Hosted quotas, provider fees, payment processing and external AI usage remain separate costs.

Local mode currently requires one online account sign-in to link the device. Offline password access requires a remembered successful password sign-in. A completely disconnected first-run account creation flow is not implemented. Local and cloud stores remain separate, with explicit transfers and identity checks.

## What this change adds

- Projects and Helpdesk modules in the Service navigation, also available through Settings → Apps.
- Customer and invoice references, owner labels, priority, target dates, estimated hours, task checklists, dated time entries and written updates.
- Separate project and ticket lifecycles, open/completed/archived filtering, sorting, pagination, CSV export and charts from stored records.
- Version-checked saves. A stale window receives an error instead of silently replacing a newer record; failed saves leave the form intact.
- Filey AI `list_work_items` and `save_work_item` tools, in the Service toolset. Writes are gated by the Projects & helpdesk capability and the agent's mode.
- Unlimited local core invoicing and free access to local storage, while retaining paid entitlements and hosted quotas.
- Corrected backup navigation and copy: the legacy JSON export contains selected summaries, whereas the existing desktop full backup includes the database and files.
- Help Center guides for the new work modules and local editions.

Work records are currently account-private. The owner text is a coordination label, not a user permission or assignment notification. The update feed is editable application data, not a tamper-proof compliance audit. Time entries are operational records, not automatic payroll or customer billing. Support target dates do not implement business-hours SLA timers or escalations.

Each work record supports 200 tasks, 500 time entries and 500 updates. These live in the same versioned record so a local save commits them together. Move them to separately paginated child tables before supporting larger projects. Existing native full backups capture these local collections.

## International business foundation

Country settings, jurisdiction snapshots, independent document currencies, Indian/UAE tax-ID format handling, EU standard-rate suggestions and quote conversion fixes are implemented. See [international-business.md](international-business.md) for exact coverage, sources and setup. The ledger remains AED and national filings/payroll are incomplete; this is not full statutory localization.

The additional `supabase/2026-09-06-international-business.sql` migration was applied on September 10 and its columns rechecked on September 12. Self-hosted installations must apply it before saving or transferring country-tagged records to cloud.

## Deployment status

The new cloud table and row-level policies are in `supabase/2026-09-06-work-items.sql`. It is additive and preserves existing data. It restricts records to the current account and organization, prevents kind/owner changes, checks linked records within the organization, increments revisions and enables realtime updates.

The initial management request failed, but the work-items migration was subsequently applied on September 10. Its table was rechecked on September 12. See [the deployment log](SUPABASE_DEPLOY.md#applied-migration-log). Local collections do not require SQL migration.

Self-hosted installations must apply the migration through an authorized Supabase SQL connection. Live checks with two disposable accounts and local/cloud copy and sync remain operational validation beyond schema deployment. The new table is included in both transfer registries. Do not bypass access restrictions or substitute a frontend service-role key.

## Competitive coverage and remaining work

The comparison is based on [Odoo's application catalogue](https://www.odoo.com/page/all-apps) and [Salesforce's sales features](https://www.salesforce.com/sales/cloud/guide/). Filey needs depth and operational validation in addition to a module name or screen.

| Area | Filey position | Work still required for broader competition |
| --- | --- | --- |
| CRM | Companies, contacts, leads, deals, conversion, tasks, notes, activity, forecasts | Assignment rules, territories, configurable sales processes, quotas, governed custom fields and duplicate merging |
| Sales | Quotes, invoices, payments, recurring documents, document templates and messaging | Contract lifecycle, subscriptions/amendments, returns/credit-note workflows, advanced price lists and CPQ |
| Purchasing & stock | Suppliers, purchase orders, receiving, stock movements and reorder workflows | Multiple warehouses/bins, transfers, reservations, serial/lot tracking, landed costs and barcode operations |
| Accounting | Ledger, expenses, tax/reporting workflows and payments | Accountant-led reconciliation and close validation, lock dates, bank feeds, jurisdiction coverage and audited statements |
| Projects | New task/time/target workflow with customer and invoice links | Team permissions, dependencies, milestones, resource planning, billable-time approval and project profitability |
| Customer service | New ticket lifecycle, targets, tasks and updates | Inbound email ingestion, shared queues, SLA calendars, escalations, customer portal and satisfaction tracking |
| People | Employee, attendance, payroll and payslip tools | Leave approvals, recruitment, expenses approvals and jurisdiction-specific payroll validation |
| Automation & AI | App tools, modes, capabilities, saved skills, reminders and integrations | A deterministic business workflow builder, human approval policies, job replay/observability and measured agent evaluations |
| Administration | Account/organization controls and module visibility; separate local/cloud stores | Server-enforced module access everywhere, local multi-user/LAN server, multiple legal entities and immutable audit trails |
| Data protection | Native database/files backup and restore; explicit sync | Restore drills, backup integrity manifests, encryption/key recovery, crash-safe file/database restore and conflict review |
| Manufacturing & retail | Not implemented as complete modules | BOMs, production/work orders, quality, maintenance, POS and e-commerce fulfillment |
| Distribution | Local web preview and build pipeline; paid license verification | Signed installer, fresh-install/upgrade tests, rollback, sustained load tests and release monitoring |

## Release checks

Latest validation: 143 test files and 983 tests passed; focused country/purchase tests passed after the final correction. Production build and TypeScript checks passed. Changed-file lint has zero errors and 125 warnings. The tests cover work-item persistence, stale-edit rejection, failed-save retention, agent gating, local invoice limits, jurisdiction snapshots, tax-ID formats, quote conversion and purchase postings. Browser review confirmed country-specific form labels and the hosted-project setup-required state. Cloud saves and a packaged native installer remain unverified.

1. Both additive migrations are deployed; verify live multi-account behavior using disposable records before expanding cloud use.
2. Test local free access on a fresh device, paid activation, offline restart and existing-license upgrades.
3. Run a complete native backup/restore drill with saved PDFs and the new work records on a disposable workspace.
4. Test stale-window conflicts and account/organization isolation in the hosted database, not only the local shim.
5. Verify actual WhatsApp and mobile share delivery as described in `invoice-messaging.md`.
6. The original source pass did not package an installer. See the [2.11.0 release notes](releases/v2.11.0.md) for the subsequent distribution and validation scope.
