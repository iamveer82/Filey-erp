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
- [ ] **[partial] RBAC enforced server-side.** Roles UI exists; verify every
  mutation is gated by RLS/policy, not just hidden buttons.
- [ ] **[partial] Audit trail completeness.** ActivityLog exists; ensure all
  money/doc/permission changes write immutable who/when/before→after rows.
- [x] **Per-route error boundaries.** `App.tsx` wraps routes in
  `<ErrorBoundary resetKey={location.pathname}>` — a page crash is contained and
  recovers on navigation; Sentry wired; ErrorBoundary.test.tsx covers it.
- [ ] **[partial] Performance budget.** Charts now lazy-loaded; lazy heavy Tools
  chunks, virtualize long lists, measure first-paint.
- [ ] **[gap] Cut `as any` (86)** in api.ts payloads — each hides a wrong-field bug.

## Tier B — ERP depth

- [ ] **[gap] Multi-currency** — currency + FX rate per doc, revaluation.
- [ ] **[partial] Bank reconciliation** — add statement import (CSV/MT940) + match.
- [ ] **[gap] Multi-warehouse/location** + stock transfers.
- [ ] **[gap] Batch/serial/lot + expiry** tracking.
- [ ] **[gap] Purchase/expense approval workflows** (threshold → approver).
- [ ] **[gap] Payroll runs** — HR has attendance only; salary calc, payslips, WPS.
- [ ] **[gap] Fixed assets + depreciation.**
- [ ] **[partial] Financial statements** — have P&L; add Balance Sheet, Cash Flow,
  Trial Balance export.
- [ ] **[gap] VAT return (FTA 201)** generation.
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

- [ ] **[in-progress] Agent data tools** — channel-webhook agent has none yet;
  wire org-scoped READ tools (invoices/balances/stock), then gated writes.
- [ ] **[gap] NL reporting** — "ask your data" → SQL/chart.
- [ ] **[gap] AI insights** — cashflow forecast, overdue-risk, reorder, anomalies.
- [ ] **[partial] Doc scanning/OCR** (tesseract + expense/invoice extract) — extend
  to bank statements + POs.

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
