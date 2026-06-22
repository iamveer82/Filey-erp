# Filey — Launch-Readiness Plan (2026-06-22)

Goal: ship the **local/offline desktop app** (Tauri) as the primary product, with
the cloud/agent layer optional. This plan is what stands between "compiles" and
"a user can install it and trust it."

## Verified baseline (facts, this session)

- `tsc --noEmit` — clean.
- `vitest` — **86 tests pass** (logic only: accounting, docNumber, money, localdb
  parity, purchase engine, agent config, ai-fetch retry). No UI/flow tests.
- `npm run tauri build` — produces exe + MSI + NSIS, **but exits 1** on the
  updater signing step (no `TAURI_SIGNING_PRIVATE_KEY`).
- 26 sidebar sections, 32 pages, 20 Rust commands.
- Code hygiene: 0 swallowed catches (good), **86 `as any`**, 0 `@ts-ignore`,
  106 console.error/warn, **no ESLint config**.

Confidence legend: ✅ logic-tested · 🟢 compiles + wired · 🟡 needs runtime check
· 🔴 known issue/blocker.

---

## P0 — Launch blockers (must fix before shipping a build)

1. **🔴 Updater signing key.** `tauri.conf.json` has `updater.active: true`,
   `createUpdaterArtifacts: true`, a pubkey, and a GitHub-releases endpoint — so
   every build *requires* `TAURI_SIGNING_PRIVATE_KEY` and fails without it.
   Decide one:
   - Generate the key (`npm run tauri signer generate`), store it as a CI secret +
     `TAURI_SIGNING_PRIVATE_KEY` env, sign releases → auto-update works. **OR**
   - If you won't ship auto-updates yet, set `updater.active: false` so builds stop
     failing. Pick one before any release.
2. **🔴 Ship a fresh exe.** The installed app was stale (built before fixes) and
   the SW issue masked it. Every release must be a clean `tauri build` of `main`,
   and the white-screen/SW fix (`ab0d74c`) must be in it.
3. **🔴 Cloud schema drift / broken-closed RLS** (only if cloud mode ships).
   17 ad-hoc `supabase/*.sql` migrations, `schema.sql` drifted, and custom-fields /
   SMS RLS were "broken-closed" (per prior notes). Before enabling cloud:
   consolidate migrations, re-run against a fresh project, and verify with
   `supabase/verify-rls.sql`. Offline-only launch can defer this.
4. **🟡→🔴 Self-host fonts.** Fonts load from Google CDN only; offline the app
   falls back to system font, and Plus Jakarta Sans (per design.md) is never even
   loaded. For an offline-first product this is a correctness gap. Install
   `@fontsource/inter` (+ Jakarta/Plex if matching the spec), import in CSS, drop
   the CDN `<link>`. Closes the launch-stall root cause permanently.

## P1 — Strongly recommended before wide release

5. **🟡 Add ESLint + a CI gate.** No linter today. Add `eslint` +
   `typescript-eslint` + `eslint-plugin-react-hooks` (catches the toast-in-deps
   class of bugs) and a GitHub Action running `typecheck + test + build` on PRs.
6. **🟡 Smoke-test each section at runtime.** Tests cover money/accounting logic,
   not UI. Need a manual or Playwright pass that, per section, exercises: load →
   empty state → create → edit → delete → PDF/export. See the section matrix below.
7. **🟡 Trim the launch-critical bundle.** `charts` (397kB) and `DatePicker`
   (192kB) sit on the first-paint path of the Overview. Lazy-load charts below the
   fold; check why a date picker is 192kB (likely a heavy date lib imported whole).
8. **🟡 Error boundaries per route.** One top-level ErrorBoundary exists; a crash
   in any lazy page blanks the content area. Wrap `<AppRoutes>` pages so one
   module failing doesn't take down navigation.
9. **🟡 Reduce `as any` (86).** Concentrated in api.ts doc payloads. Each is a
   place the compiler can't catch a wrong field (e.g. the `show_logo` payload
   casts). Type the doc row once; delete the casts.

## P2 — Polish / post-launch

10. Loading skeletons over spinners on data-heavy pages (Reports, Accounting).
11. Consistent empty states across list pages (UX-PLAN Tier 1).
12. Keyboard `n`-to-create per module.
13. Self-update UX (UpdateNotice) wired to the signed updater once P0.1 is done.

---

## Section-by-section status (26 sections)

| Section | Status | Notes |
|---|---|---|
| Overview (dashboard) | 🟢 | KPI number truncation fixed (1f69848); runtime-verify charts render with real data |
| Filey AI / Agent | ✅🟢 | Loop hardened + tested; needs a connected model to verify end-to-end tools |
| Inventory | 🟡 | Compiles; verify stock adjust + low-stock + import |
| Orders | 🟡 | Verify cross-module post from invoice finalize |
| Invoicing | ✅🟢 | Numbering + logo toggle added & tested; verify PDF export + finalize→Accounting |
| Quoting | 🔴 | **Conditional-hooks bug** — the editor's `useState`/`useEffect` live under `if (form) {` (Quoting.tsx:399+), so opening a quote changes the hook count and React throws "rendered more hooks than previous render." Fix: extract a `<QuoteEditor>` component like Invoicing's `<Editor>`. Found via the new ESLint gate. |
| CRM / Customers / Suppliers | 🟡 | Verify CRUD, deal drawer, activity timeline |
| Follow-ups | 🟡 | Verify reminder create + due logic |
| Purchase / POs / Purchase Invoices | ✅🟡 | Purchase-invoice engine tested; verify PO→invoice→accounting + VAT split (known gap: PO VAT split) |
| Reports | 🟡 | Heavy charts; verify date ranges + export |
| People (HR) | 🟡 | Verify attendance marking |
| Accounting | ✅ | Double-entry, VAT split, COGS, repair tool all tested |
| Tools (PDF) | 🟡 | Large lazy chunks (heic 3MB, pdf 1.2MB) load on demand; verify merge/split/OCR |
| My Files | 🟡 | Verify local file storage path (Tauri fs) + archive-on-finalize |
| Settings | 🟢 | AI providers + base-URL autofill + invoice numbering added; verify all panels save |
| Delivery / Receipts / Declaration | 🟡 | Letterhead/template docs; verify PDF |
| Cheques / Bank Accounts | 🟡 | Verify register CRUD |
| Email / SMS Templates | 🔴(cloud) | SMS RLS broken-closed in cloud; offline N/A |

"✅ logic-tested · 🟢 compiles+wired · 🟡 verify at runtime · 🔴 known issue."

---

## Backend (Tauri/Rust) — 20 commands

- 🟢 `storage` (9): db path resolve, data-dir set, backup/restore, doc file write,
  restart. Verify backup/restore round-trip on a real DB.
- 🟢 `sync` (6): offline cache + outbox. Verify outbox replays on reconnect.
- 🟢 `email` (1, SMTP) + `composio` (4): cloud-layer; verify only if shipping cloud.
- `setup()` opens local SQLite — fast, not a launch bottleneck.
- **Action:** add a Rust integration check (open temp DB → init → write → read) so a
  schema change can't silently break the desktop data layer.

## Testing / QA gaps

- No component/UI tests, no e2e. Biggest risk surface for "section X is broken."
- Add: (a) Playwright smoke per section (load + one CRUD), (b) a Rust db round-trip
  test, (c) keep the logic suite green in CI.

---

## Suggested order

1. P0.1 updater decision + P0.2 clean build → you have a shippable exe.
2. P0.4 self-host fonts → offline launch is correct, not just non-blocking.
3. P1.5 ESLint + CI → stop regressions.
4. P1.6 section smoke pass → fill every 🟡 to 🟢/🔴, fix the 🔴s found.
5. P0.3 cloud schema (only if/when cloud ships).
6. P1.7 bundle trim + P2 polish.

Offline-only launch can ship after 1, 2, 4. Cloud needs 3 as well.
