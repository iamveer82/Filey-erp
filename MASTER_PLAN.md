# Filey ERP — Master Design & Deployment Plan

**Created:** 2026-07-13
**Current version:** v0.4.0
**Codebase:** 277 files, 73,336 lines of TypeScript/React
**Stack:** React 19 + TypeScript + Vite + Tailwind 4 + Tauri 2 + Supabase
**Target:** Production deployment for UAE SMBs

---

## Executive Summary

Filey ERP is a 22-module offline-first desktop ERP with a local SQLite engine and Supabase cloud sync. The codebase is mature (30+ tests, RLS policies, e-invoice compliance, CI/CD pipelines). However, the **visual design system is inconsistent** — some pages use the new Apple-style cards, others use old patterns. This plan unifies the design, hardens the system, and prepares for production deployment.

---

## Phase 1: Design System Unification (Week 1)

### 1.1 Apply Apple-style cards everywhere
The dashboard KPI cards are done. Now apply the same patterns to:

| Page | File | Current State | Target |
|------|------|--------------|--------|
| Reports | `Reports.tsx` (1731 lines) | Old card patterns | Website KPI cards + chart cards |
| Inventory | `Inventory.tsx` | Table-heavy | KPI summary + clean table |
| Invoicing | `Invoicing.tsx` | Functional, not polished | Apple-style doc list |
| Customers | `Customers.tsx` | Basic grid | Card grid with hover lift |
| Orders | `Orders.tsx` | Basic | KPI strip + order cards |
| Bank Accounts | `BankAccounts.tsx` | Dense | Clean account cards |
| CRM | `Crm.tsx` | Basic | Pipeline card view |
| People | `People.tsx` | Basic table | Role cards |
| Settings | `settings/index.tsx` | Tabbed | Apple-style settings panels |

### 1.2 Typography upgrade (all pages)
- `font-optical-sizing: auto` on all headings
- `letter-spacing: -0.025em` on titles, `-0.005em` on body
- `line-height: 1.05-1.1` for large text, `1.55` for body
- `font-variant-numeric: tabular-nums` on all numbers

### 1.3 Motion & interaction (Emil Kowalski principles)
- Add `transition: transform 200ms var(--ease-out)` to all cards
- `hover:-translate-y-[3px] hover:shadow-lg` on cards
- `active:scale-[0.98]` on all pressable elements
- `@media (hover: hover) and (pointer: fine)` gating for hover states
- Stagger reveal animations (30-50ms between items)
- `prefers-reduced-motion` support everywhere

### 1.4 Color & spacing consistency
- Hairline borders: `border-brand-200` (light), `border-[#3A3D45]` (dark)
- Card radius: `rounded-2xl` everywhere (16px)
- Gap: `gap-3` for KPI grids, `gap-4` for sections
- Shadow: `shadow-bento` resting, `shadow-lg` on hover
- No heavy shadows in light mode

---

## Phase 2: Component Library Hardening (Week 1-2)

### 2.1 Extract reusable components
```
src/components/design-system/
  ├── KpiCard.tsx        (done — in MetricCard)
  ├── ChartCard.tsx     (wrap TrendChart in browser-chrome style)
  ├── DataTable.tsx      (clean table with hover rows, status badges)
  ├── StatusBadge.tsx   (Paid=green, Unpaid=red, Draft=gray pills)
  ├── EmptyState.tsx    (icon + title + subtitle + CTA)
  ├── PageHeader.tsx    (title + subtitle + action buttons)
  ├── SectionCard.tsx   (InfoCard with consistent padding)
  └── SearchBar.tsx     (Apple-style search with icon)
```

### 2.2 Remove dead CSS / unused components
- Audit `ui.tsx` (1022 lines) — extract only what's used
- Remove `InsightsCard` (already removed from imports)
- Clean up `AnimatedThemeToggler` (light mode only now)
- Remove old `StatCard` back-compat wrapper

### 2.3 Standardize icons
- All icons use `AppIcon` component (already exists)
- Consistent sizes: `w-5 h-5` for cards, `w-4 h-4` for inline
- Icon backgrounds: `rounded-xl p-1.5` with tone-based color

---

## Phase 3: Reports Module Redesign (Week 2)

### 3.1 Current state
`Reports.tsx` is 1731 lines — the largest file in the codebase. Needs splitting.

### 3.2 Target architecture
```
src/pages/reports/
  ├── Reports.tsx          (router shell + tab nav)
  ├── DashboardTab.tsx      (KPI cards + revenue chart + transactions table)
  ├── SalesTab.tsx          (invoice analytics)
  ├── InventoryTab.tsx      (stock valuation + movement)
  ├── FinancialTab.tsx      (P&L + balance sheet + VAT)
  ├── CustomersTab.tsx      (top customers + receivables aging)
  ├── SuppliersTab.tsx      (top suppliers + payables aging)
  └── components/
      ├── ReportKpi.tsx      (website-style KPI card)
      ├── ReportChart.tsx    (bar/line chart in browser-chrome frame)
      └── ReportTable.tsx    (clean table with status pills)
```

### 3.3 Dashboard tab layout (matches website)
- 4 KPI cards in a row (Revenue, Orders, Inventory Value, Overdue)
- Revenue bar chart (12 monthly bars, #FFD600)
- Recent transactions table with status badges
- Period selector (Today / Week / Month / Quarter / Year)

---

## Phase 4: Production Hardening (Week 2-3)

### 4.1 Security
- [ ] Verify RLS on ALL tables using `verify-rls.sql`
- [ ] Audit Supabase secrets — rotate anon key if exposed
- [ ] Add rate limiting to edge functions
- [ ] Enable Supabase MFA for admin accounts
- [ ] Audit CSP in `tauri.conf.json` (already restrictive)
- [ ] Verify Stripe webhook signature validation
- [ ] Add input sanitization on all form fields

### 4.2 Performance
- [ ] Lazy-load all route pages (already partially done with charts)
- [ ] Split `Reports.tsx` (1731 lines → multiple chunks)
- [ ] Virtualize large tables (Inventory, Customers)
- [ ] Add loading skeletons to every data fetch
- [ ] Debounce search inputs (300ms)
- [ ] Cache API responses with stale-while-revalidate

### 4.3 Reliability
- [ ] Add error boundaries to every route (already on App.tsx)
- [ ] Implement retry logic for Supabase calls
- [ ] Add offline queue for mutations when local-db is used
- [ ] Test backup/restore flow end-to-end
- [ ] Add Sentry error reporting (already imported, verify config)

### 4.4 Testing
- [ ] Run existing 30+ tests — fix any failures
- [ ] Add E2E smoke tests for critical flows (login → invoice → save)
- [ ] Add RLS tenant isolation test
- [ ] Add build verification to CI (already in ci.yml)

---

## Phase 5: Deployment Infrastructure (Week 3)

### 5.1 Desktop App (Tauri)
- [x] Build pipeline working (build.ps1 with MSVC fix)
- [x] GitHub Release created for v0.4.0
- [x] MSI + NSIS + AppImage + DEB + RPM assets uploaded
- [ ] Generate Tauri signing key for auto-updater
- [ ] Set `TAURI_SIGNING_PRIVATE_KEY` in GitHub Secrets
- [ ] Configure `release.yml` to sign builds automatically
- [ ] Test auto-update flow (v0.3.0 → v0.4.0)

### 5.2 Supabase
- [ ] Apply all migrations in order to production Supabase
- [ ] Deploy edge functions:
  - `stripe` (billing)
  - `send-email` (notifications)
  - `overdue-reminders` (scheduled)
  - `agent-jobs` (AI tasks)
- [ ] Set Supabase secrets:
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`
  - `RESEND_API_KEY` (email)
  - `OPENAI_API_KEY` (AI features)
- [ ] Configure Supabase Auth (email + Google OAuth)
- [ ] Set up database backups (daily, 30-day retention)

### 5.3 CI/CD Pipeline
- [x] `ci.yml` — typecheck + lint + test + build on every push
- [x] `release.yml` — builds desktop installers on tag push
- [x] `rls.yml` — RLS policy tests
- [ ] Add Supabase schema migration to CI
- [ ] Add automatic release notes from CHANGELOG.md
- [ ] Add staging environment for testing before production

### 5.4 Monitoring
- [ ] Configure Sentry DSN in `.env`
- [ ] Add uptime monitoring (Supabase + edge functions)
- [ ] Set up alerting for failed payments
- [ ] Log aggregation for edge functions

---

## Phase 6: Pre-Launch Checklist (Week 3-4)

### 6.1 Functional testing
- [ ] Create company → add product → create invoice → receive payment
- [ ] Create purchase order → receive goods → pay supplier
- [ ] Generate VAT return → export e-invoice XML
- [ ] Test offline mode → go offline → create invoice → sync when online
- [ ] Test backup → backup locally → restore on fresh install
- [ ] Test multi-user → invite user → assign role → verify permissions
- [ ] Test Stripe billing → subscribe → upgrade → cancel

### 6.2 UAE compliance
- [ ] FTA tax invoice format (TRN, tax breakdown, sequence)
- [ ] PINT-AE e-invoice XML (2025-Q2 spec)
- [ ] Emirate code mapping (3-letter PINT-AE)
- [ ] VAT return (5% standard rate)
- [ ] Credit note handling
- [ ] Sequential invoice numbering

### 6.3 Design review
- [ ] Every page uses Apple-style cards
- [ ] Consistent typography (tracking, leading, optical sizing)
- [ ] Hover states on all interactive elements
- [ ] Active press feedback (scale 0.97-0.98)
- [ ] No layout shift on data load (skeletons)
- [ ] Dark mode works (if kept) / Light mode clean
- [ ] Mobile responsive (tablet minimum, 1100px+ desktop)
- [ ] No console errors or warnings

### 6.4 Documentation
- [ ] Update README.md with setup instructions
- [ ] Create USER_GUIDE.md for end users
- [ ] Document Supabase setup steps
- [ ] Document Stripe setup steps
- [ ] Document Tauri signing key generation

---

## Phase 7: Launch (Week 4)

### 7.1 Beta launch
- [ ] Deploy to 3-5 pilot businesses
- [ ] Collect feedback for 1 week
- [ ] Fix critical bugs
- [ ] Iterate on UX based on usage patterns

### 7.2 Public launch
- [ ] Publish v1.0.0 with signed auto-updater
- [ ] Launch landing page (filey-erp-website.html → deploy)
- [ ] Set up support email + WhatsApp
- [ ] Create onboarding video
- [ ] Submit to UAE business software directories

---

## Design System Reference

### Colors (from website)
| Token | Light | Dark |
|-------|-------|------|
| Yellow (brand) | `#FFD600` | `#FFD600` |
| Success | `#3FB984` | `#3FB984` |
| Warning | `#F59E0B` | `#F59E0B` |
| Danger | `#E5484D` | `#E5484D` |
| Surface | `#FFFFFF` | `#24262C` |
| Surface-2 | `#F8FAFC` | `#1A1C20` |
| Border | `#E2E8F0` | `#3A3D45` |
| Text | `#0F172A` | `#F1F5F9` |
| Muted | `#64748B` | `#94A3B8` |

### Typography
| Element | Size | Weight | Tracking | Leading |
|---------|------|--------|----------|---------|
| Page title | 28px | 700 | -0.025em | 1.1 |
| Section title | 20px | 700 | -0.025em | 1.1 |
| Card value | 22px | 700 | -0.02em | 1.05 |
| Card label | 11px | 500 | 0 | 1.33 |
| Body | 14px | 400 | -0.005em | 1.55 |
| Badge | 11px | 600 | 0 | 1.33 |

### Spacing
| Element | Value |
|---------|-------|
| Page padding | 24px (px-6) |
| Card padding | 16px (p-4) |
| KPI grid gap | 12px (gap-3) |
| Section gap | 16px (gap-4) |
| Card radius | 16px (rounded-2xl) |
| Button radius | 999px (pill) |

### Motion
| Interaction | Property | Duration | Easing |
|-------------|----------|----------|--------|
| Card hover | translateY(-3px) + shadow | 200ms | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Card press | scale(0.98) | 160ms | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Button press | scale(0.97) | 160ms | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Reveal on scroll | opacity + translateY(24px) | 600ms | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Stagger between items | delay | 30-50ms | — |

---

## Priority Order

1. **Phase 1.1** — Reports.tsx redesign (highest impact, largest file)
2. **Phase 1.1** — Inventory + Invoicing card redesign
3. **Phase 3** — Split Reports.tsx into modules
4. **Phase 4.1** — Security audit (RLS verification)
5. **Phase 4.2** — Performance (lazy-load, virtualize)
6. **Phase 5** — Deployment infrastructure
7. **Phase 6** — Pre-launch checklist
8. **Phase 7** — Launch

---

## Production Hardening Audit (2026-07-13)

### 1. Tests & Type Safety

- **Vitest**: 35 test files, 192 tests — ALL PASSING ✅
- **TypeScript** (`tsc --noEmit`): 1 error fixed (unused `Tag` import in `Inventory.tsx`) → clean ✅
- **ESLint** (`eslint .`): 0 errors, 380 warnings (all `@typescript-eslint/no-explicit-any`) — non-blocking, mass refactor would risk business logic

### 2. Security Audit

#### RLS (Row-Level Security)

- **All 33 business tables** have RLS enabled with org-scoped or user-scoped policies ✅
- Tables verified: products, orders, order_items, employees, attendance, payroll, accounts, expenses, transactions, app_users, app_settings, audit_log, crm_leads, crm_customers, crm_opportunities, crm_activities, company_profile, invoice_docs, invoice_doc_items, invoice_payments, quotations, quotation_items, quotation_templates, tool_runs, suppliers, purchase_orders, purchase_order_items, stock_movements, advances, po_payments, payment_receipts, follow_ups, invoice_recurrence
- Infrastructure tables with RLS: organizations, org_members, invitations, org_messages, org_devices, notifications, profiles, agent_pending_actions, sync_state, licenses, license_devices, user_assets, user_files
- **No tables missing RLS** ✅
- `verify-rls.sql` updated to include 6 previously missing tables: stock_movements, advances, po_payments, payment_receipts, follow_ups, invoice_recurrence
- `audit_log` is correctly append-only (SELECT + INSERT only, no UPDATE/DELETE policy) ✅
- `force_org_id()` trigger pins org_id on insert and freezes it on update — prevents cross-tenant row injection ✅
- Security-definer functions (`current_org`, `is_org_admin`, `handle_new_user`) all pin `search_path = public` ✅

#### Stripe Webhook Signature Validation

- `supabase/functions/stripe/index.ts` uses `stripe.webhooks.constructEventAsync(raw, sig, WEBHOOK_SECRET)` ✅
- Returns 400 on signature failure ✅
- Webhook secret from `STRIPE_WEBHOOK_SECRET` env var ✅
- Authenticated actions verify JWT via `supabase.auth.getUser(jwt)` ✅
- Open-redirect protection: `SITE_URL` takes priority over caller-controlled `Origin` header ✅

#### CSP (Tauri)

- `tauri.conf.json` CSP is restrictive: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, no `unsafe-eval` for JS ✅
- `connect-src` limited to self, Supabase, frankfurter API, Google Fonts ✅
- `style-src` allows `'unsafe-inline'` + Google Fonts (needed for Tailwind + font loading) ✅
- `img-src` allows `data:` and `blob:` (needed for logos/stamps) ✅

#### Input Sanitization Notes

- Form inputs rely on Supabase RLS for server-side isolation; client-side sanitization is basic (`.trim()`, `String()`)
- Edge function `stripe/index.ts` uses `String(payload.field ?? "")` for all input coercion ✅
- Consider adding: DOMPurify for any user HTML rendering, and server-side CHECK constraints beyond the existing non-negative money/quantity checks

### 3. Performance

- **Lazy loading**: All 28 module pages use `React.lazy()` in `src/modules/registry.tsx` ✅
- **Suspense**: App.tsx wraps routes in `<Suspense fallback={<Splash />}>` ✅
- **Manual chunks**: `vite.config.ts` splits react, charts (recharts), pdf (pdf-lib, pdfjs-dist) ✅
- **Large pages** (>500 lines, all already lazy-loaded):
  - Invoicing.tsx (3779), Quoting.tsx (2530), PurchaseOrders.tsx (2470), Inventory.tsx (1458)
  - These are in separate chunks due to lazy loading — splitting further would add complexity without meaningful gain
- **Skeleton fallbacks**: Splash (`FileyLoader`) used as Suspense fallback ✅ (could be enhanced with per-page skeletons later)

### 4. Reliability

- **ErrorBoundary**: Wraps all routes in `App.tsx` with `resetKey={location.pathname}` (recovers on navigation) ✅
- **ErrorBoundary**: Also wraps entire app in `main.tsx` ✅
- **Sentry**: Configured in `src/lib/monitoring.ts` — dynamically imported, only active in production with `VITE_SENTRY_DSN` set ✅
- **Offline mode**: `dataMode.ts` cleanly switches local/cloud; `api.ts` implements read-through cache + offline outbox ✅
- **API error handling**: All API functions in `api.ts` use try/catch or throw on error; `readCached` falls back to cache on network failure ✅
- **Outbox replay**: Offline writes queued and replayed on reconnect (`flushOutbox` called on `online` event) ✅

### 5. Documentation

- `.env.example` updated with all VITE_ env vars + documented edge function secrets ✅
- `README.md` is current and accurate ✅
- `verify-rls.sql` has audit comment at top with full findings ✅

### 6. Files Modified

- `src/pages/Inventory.tsx` — removed unused `Tag` import (TS fix)
- `supabase/verify-rls.sql` — added audit results comment, added 6 missing tables to business_tables list
- `.env.example` — expanded with all env vars + edge function secret documentation
- `MASTER_PLAN.md` — appended this Production Hardening Audit section