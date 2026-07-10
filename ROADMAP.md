# Filey — Professional CRM/ERP Roadmap

Status of making Filey a professional-grade CRM + ERP. Breadth already strong
(26 modules: Accounting w/ double-entry + VAT, Invoicing, Quoting, CRM,
Purchase, HR, Reports, Bank/Cheques, PDF Tools, My Files). The gaps below are
what separate "feature-rich" from "professional and trustworthy."

Legend: `[have]` shipped · `[partial]` exists but incomplete · `[gap]` missing.
Ordered by leverage — Tier A first (reliability is what "professional" means).

---

## Tier A — Trust & quality foundation (do first)

- [x] **Automated UI smoke tests — 26 pages.** `src/pages/__tests__/pages-smoke.test.tsx`
  mounts 26 pages (all list pages + heavy: Reports/PdfTools/Tools/MyFiles/AgentChat,
  and CustomerDetail/SupplierDetail via route params) with a mocked data layer;
  catches the conditional-hooks crash class (cf. the Quoting bug). Remaining:
  Settings panels, auth/marketing pages, then Playwright e2e.
- [x] **RBAC enforced server-side.** Verified: per-member `<tbl>_access` RLS
  (own rows + admin-all + opt-in shared-read), org-scoped throughout, with a
  `force_org_id` trigger pinning org on every write. `company_profile` write is
  admin-only. `verify-rls.sql` rewritten name-agnostically (it was false-FAILing
  the `_access` tables) + Section 1c asserts audit immutability.
- [x] **Audit trail — immutable + before→after.** `log_audit()` records a
  before→after diff (`audit_log.changes` jsonb); `audit_log` is append-only
  (select+insert, no update/delete — RLS-enforced); coverage now includes money
  movements (invoice/PO payments). Shown in ActivityLog "Changes" column.
- [x] **Per-route error boundaries.** `App.tsx` wraps routes in
  `<ErrorBoundary resetKey={location.pathname}>` — a page crash is contained and
  recovers on navigation; Sentry wired; ErrorBoundary.test.tsx covers it.
- [ ] **[partial] Performance budget.** Charts now lazy-loaded; lazy heavy Tools
  chunks, virtualize long lists, measure first-paint.
- [x] **Cut `as any` in api.ts (86 → 0).** Boundary reads now use typed row casts
  (InvoiceDoc/QuotationDoc/PurchaseOrder/CompanyProfile/ReceiptDoc + inline shapes);
  payload-field typos are now compile errors. tsc clean, 97 lib tests pass.

## Tier B — ERP depth

- [~] **[partial] Multi-currency** — invoices freeze an FX rate at save
  (`invoice_docs.fx_rate`, AED per unit) and show an AED-equivalent under the
  total (`aedEquivalent`, tested). TODO: quotations/POs, and balance-sheet
  revaluation of open foreign balances.
- [~] **[partial] Bank reconciliation** — CSV import + matcher, persisted
  reconciled state (`transactions.reconciled_at`, confirmed matches leave the
  pool) and one-click "record expense" for statement-only money-out shipped
  2026-07-11. TODO: MT940, record money-in (needs an income quick-entry).
- [ ] **[gap] Multi-warehouse/location** + stock transfers.
- [ ] **[gap] Batch/serial/lot + expiry** tracking.
- [ ] **[gap] Purchase/expense approval workflows** (threshold → approver).
- [~] **[partial] Payroll** — `runPayroll` posts to the ledger; **payslip** PDF
  per employee shipped (People → row → Payslip, editable allowances/deductions).
  TODO: a payroll-run UI (batch a month), and **WPS SIF** export — the latter
  needs new bank fields (employee IBAN + labour-card, employer MOL establishment
  id + bank routing) before the SCR/EDR file can be built.
- [ ] **[gap] Fixed assets + depreciation.**
- [~] **[mostly] Financial statements** — P&L + **Trial Balance** + **Balance
  Sheet** (with A=L+E balanced check) shipped in Reports + CSV
  (`computeTrialBalance`/`computeBalanceSheet`, tested). Cash flow is a simplified
  in/out/net summary; full categorised (operating/investing/financing) still TODO.
- [~] **[partial] VAT return (FTA 201).** Core boxes (1 standard supplies, 9
  standard expenses, 14 net VAT due) computed from the ledger + shown in Reports
  with period picker + CSV export (`computeVatReturn`, tested). TODO: zero-rated/
  exempt (boxes 4–5) from invoice line tax_category, per-emirate split, reverse-charge.
- [ ] **[gap] Budgeting / cost centers.**

## Tier C — CRM depth

- [ ] **[partial] Pipeline/leads** — Twenty-style DealDrawer exists; add lead
  capture, stages, win/loss, forecast.
- [ ] **[gap] 2-way email + calendar sync** (Composio Gmail is send-only).
- [ ] **[gap] Contact dedup/merge.**
- [ ] **[gap] Quote/contract e-signature.**
- [ ] **[partial] Customer portal** (PortalView) — verify pay-online + doc access.
- [ ] **[gap] Marketing** — campaigns, bulk email/SMS, template→sequence flows.

## Tier D — AI differentiation (the stated edge)

- [x] **Agent data tools (READ).** channel-webhook agent now has four org-scoped
  READ tools (financial summary, invoices, low-stock, customer lookup) via
  Anthropic tool-use (`tools.ts`); org-scoping enforced + tested. Gated WRITE
  tools (create invoice, mark paid) still TODO behind a confirm step.
- [ ] **[gap] NL reporting** — "ask your data" → SQL/chart.
- [~] **[partial] AI insights** — dashboard Insights card shipped 2026-07-11
  (`lib/insights.ts`: 30/60/90-day cashflow forecast, overdue-risk customers,
  expense anomalies, stockout ETA — deterministic, offline, tested). TODO:
  AI-narrated digest of the same numbers, trend charts.
- [~] **[partial] Doc scanning/OCR** — invoice + expense extract shipped;
  purchase-mode scan (supplier bill → draft purchase invoice, seller as party,
  seller TRN) added 2026-07-11. TODO: bank statements + POs.

## Tier E — Platform / integration

- [ ] **[gap] Public REST/webhook API** for integrations.
- [ ] **[partial] Notifications engine** — add due/overdue/approval triggers.
- [ ] **[gap] Onboarding wizard** (company → tax → first invoice).
- [ ] **[partial] i18n** — Arabic catalog exists; verify RTL across all pages.
- [ ] **[gap] Mobile** — responsive audit (chat-channel agent already gives mobile reach).

---

Highest ROI: **Tier A** (trust) + **Tier D agent tools** (differentiator, mid-build).
See also `LAUNCH-READINESS.md` (per-section status) and the
`personal-agent-channels` memory.
