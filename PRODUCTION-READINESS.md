# Filey ERP — Production Readiness Plan

_Generated 2026-06-05. Branch `ui/polish-pass`. Live bug-hunt done via browser automation against `localhost:1420` (logged in as virendra, real data)._

---

## 1. Bug-hunt results (live UI)

Drove every nav module (22 routes) + global controls + every primary "New/Add/Export" button with a runtime collector hooked into `console.error`, `window.onerror`, `unhandledrejection`, and `fetch` (catches failed Supabase calls + mutations).

### Health — clean

- All **22 routes load** with **zero console errors** and **zero failed Supabase calls**.
- All **New forms / editors render**: Customers, Suppliers, Orders, Cheques, Bank Accounts, Email Templates (modals); Invoicing, Quoting, Purchase Orders, Delivery, Payment Receipts (inline editors).
- Global controls OK: notifications, language, account menu, Ask AI, dark mode.
- Reports charts render (recharts), exports fire, no crashes.
- No demo/test data left behind (one test product created → verified → deleted).

### Findings

| #   | Sev      | Area       | Finding                                                                                                                                                                                                                                                                                                                                      |
| --- | -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ✅ FIXED | Inventory  | "Add product" failed (PGRST204) — missing DB columns. Fixed + verified live (incl. custom fields).                                                                                                                                                                                                                                           |
| 2   | 🟠 MED   | Reports    | `Reports.tsx:75` counts revenue only where `invoice.status === "paid"` → shows **Total Revenue AED 0.00**, while Overview shows **Collected AED 354,000**. Two divergent revenue definitions. Invoices appear to live in `sent`/AR state with payments recorded elsewhere → Reports under-reports paid revenue as 0. Financial-accuracy bug. |
| 3   | 🟡 LOW   | Follow-ups | "Add" is silent when the note is empty — no inline validation hint.                                                                                                                                                                                                                                                                          |
| 4   | 🟡 LOW   | Search     | Global header search returned 0 results for "inv" in automation — needs manual confirmation (may be selector miss, not a real bug).                                                                                                                                                                                                          |

---

## 2. Production-readiness plan

### P0 — Deploy blockers

1. **Schema-drift discipline.** This bug class (TS types ahead of DB) has now hit **twice**: `invoice-missing-columns.sql`, `product-missing-columns.sql`. There are ~11 loose ad-hoc `.sql` files in `supabase/` with no ordering or applied-state tracking.
   - Adopt ordered, tracked migrations (numbered files or a `schema_migrations` table), OR a boot-time schema assertion that fails loudly if expected columns are missing.
   - Apply `product-missing-columns.sql` to prod (✅ already applied to `voyrjqgaypiylwskkwpr`).
2. **Secrets hygiene + rotation.** `.env.local` holds a live `sbp_` management token + `RESEND_API_KEY` in the working tree (gitignored — confirmed). Before/after deploy:
   - Rotate both `sbp_` tokens (the one used this session + the one in `.env.local`).
   - Confirm `.env*` never ships in the static bundle (only `VITE_`-prefixed vars are inlined — audit none are secret; `VITE_SUPABASE_ANON_KEY` publishable is fine).
3. **Env validation.** App should fail fast with a clear message if `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing at runtime (currently throws generic "Cloud storage is not configured").

### P1 — Fix before deploy

4. **Reports revenue accuracy (finding #2).** Unify revenue/collected definition across Overview ↔ Reports. Decide source of truth (invoice `amount_paid` / payment receipts vs `status==='paid'`) and use it everywhere.
5. **Enable Sentry in prod.** `monitoring.ts` is a no-op unless `VITE_SENTRY_DSN` is set + PROD build. Set the DSN in the host env or error tracking is effectively off.
6. **CI gate.** Ensure `npm run build` + `vitest run` + `npm run test:rls` run in CI before deploy. (`.github/workflows/rls.yml` exists — verify it actually gates merges.)

### P2 — Hardening

7. **Storage key sanitization** (`files.ts`): sanitize user-derived filenames `name.replace(/[^\w.\-]+/g,"_")` (defense-in-depth, noted in prior security audit).
8. **Bundle.** Initial `index` 426 kB + `react` 259 kB gzip ~135/84 kB — acceptable. heic-to (3 MB), pdf (1.2 MB), pptx, jszip already code-split into lazy chunks — confirm they're only dynamically imported (not on the critical path).
9. **Clean up** 4 `console.*` and 3 `TODO/FIXME` in `src/`.

### P3 — Polish

10. Follow-ups empty-add hint (finding #3).
11. Verify global search (finding #4).

### Deploy mechanics

- **Frontend**: static `dist/` on Vercel/Netlify/Cloudflare Pages. Hash routing (`#/...`) → no SPA rewrite rules needed.
- **Host env vars**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN`.
- **Supabase edge functions**: deploy `overdue-reminders`, `run-tool`, `stripe`; set function secrets (service role, `RESEND_API_KEY`, etc.).
- **Worker** (`worker/`, per `USER-ACTION-ITEMS.md`): host on Fly/Railway with `SUPABASE_URL` + service role.
- Note: repo still carries Tauri config (`src-tauri/`, vite server pinned to 1420). Confirm the web SaaS build path is `vite build` → static, and Tauri is not part of the prod deploy.
