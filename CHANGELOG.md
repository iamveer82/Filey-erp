# Changelog

## v2.2.0 — 2026-07-17

### Front-end — Filey-DEMO minimal design system
- **DEMO-parity list pages** — search + status filter chips, per-row `RowActions` (quick view, edit, duplicate, send via WhatsApp/email/SMS/copy-link, delete behind confirm) and `QuickViewModal` across Invoicing, Quoting, Orders, Customers, Suppliers, Purchase, Purchase Orders, Inventory, People, Accounting, Bank Accounts, Cheques, Payment Receipts, Declaration Letters, Delivery Challans
- **Dashboard** — real 30-day-vs-prior delta chips on KPIs, CSV export of the KPI snapshot
- **Detail pages** — Customer/Supplier detail rebuilt to the joined-KPI + contact-card + quiet-table pattern with row actions and quick views
- **Settings** — new Appearance section (light/dark + 7-accent picker driving charts), Apps & Modules grid with counts and Enable-all, Backup layout with last-export time, horizontal section tabs
- **New Integrations page** — honest directory: deep-links to real config surfaces, live connection states, "Coming soon" for the rest
- **Public pages** — Landing/Login/Portal token-unified with dark-mode fixes; portal Pay button now shows the VAT-inclusive total
- **Everything else** — Reports/Overview charts on the accent-aware palette, AgentChat restyle, MyFiles search + joined rows, Tools grid, Follow-ups quiet rows with status pills
- `design.md` rewritten for the new system

### Features
- **Recurring follow-ups** — completing a repeating follow-up spawns its next occurrence (daily/weekly/monthly)

### Fixes
- Dead edit flows wired up (Bank Accounts, Cheques, Email Templates)
- Landing demo chart scale, Login brand panel dark mode, mojibake in PDF tools toasts

---

## v0.4.0 — 2026-07-13

### Major Updates
- **E-invoice PINT-AE compliance** — aligned XML with 2025-Q2 UAE spec
- **Emirate code normalization** — auto-remaps legacy AE-xx codes to PINT-AE 3-letter
- **Offline backup & restore** — full local disk file storage with one-click restore
- **Nested folders in My Files** — organize documents in folder hierarchy
- **Apache-2.0 relicensing** — open source friendly license
- **Bank accounts overhaul** — draggable, advances, improved UI
- **Declaration letter improvements** — better formatting and data flow
- **Reports overhaul** — major rework of financial and inventory reports (1700+ lines)
- **Local-mode fixes** — text↔number coercion matching PostgREST behavior

### Removed
- Old licensing system (replaced with simpler model)
- Sync engine (replaced with local-first approach)
- Insights module (integrated into dashboard)
- Tesseract WASM files (moved to cloud processing)
- VYAPAR_ANALYSIS.md (archived)

### Infrastructure
- Stripe function updates for billing
- Supabase schema cleanup
- Test suite restructured

---

## v0.3.0 — Previous release
- CRM credit limits + opening balances
- Receivable/Payable KPI cards
- Round-off + per-line discount %
- Vyapar-parity phase 1: payment terms, dates, words, credit fields
- Low-stock alert fix