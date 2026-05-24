# Filey — things YOU need to do

Running list of setup steps that need your hands (keys, deploys, infra).
The code is built; these activate it. Ask anytime and I'll point you here.

## Outstanding now

- [ ] **Deploy the `run-tool` edge function** (server PDF tools):
      `supabase functions deploy run-tool`
- [ ] **Stand up the worker** (heavy tools — OCR/Office/PDF-A):
      `worker/` → Fly or Railway + set `SUPABASE_URL` and
      `SUPABASE_SERVICE_ROLE_KEY` (see `worker/README.md`).
- [ ] **Supabase Pro** (recommended for production): no project pause,
      daily backups, more storage/egress. Pick the region closest to your
      users.
- [ ] **Push to GitHub** when you want the latest commits remote (say "push").

## Done

- [x] DB migrations applied (2026-05-23): `crm_customers.trn`, `follow_ups`,
      `tool_jobs` table + `tool-inputs` bucket.
- [x] Security pass (2026-05-23): `npm audit` clean (0 vulns); confirmed RLS
      on every table; fixed a worker IDOR (input_path could point at another
      user's file) with app guards + a DB `WITH CHECK` (applied to your DB).
      No secrets in the repo. NOTE: the worker/edge guards take effect when
      you (re)deploy them — code already updated.

- [x] Multi-currency complete (2026-05-24): invoices/quotes/labels/reports
      now follow each document's currency and the org display currency
      (no schema change — the `currency` columns already existed).
- [x] Dark-mode text readability fixed (2026-05-24): white text on yellow
      surfaces and dark-on-dark muted text.
- [x] Filey loading screen (2026-05-24): 6-scene animated mascot splash.

## Coming (will be added as features land)

These remaining backlog items are **blocked on you** — I left them rather
than build them unsupervised because they need secrets, a DB migration
(your one-time token was revoked), or risky live infra:

- **Recurring invoices + overdue auto-reminders (#17)** → needs a schema
  migration (recurrence fields) + a scheduled job (cron/edge). The list
  already flags overdue invoices; the auto-generate/notify half needs the
  migration applied. Send a fresh token or run the SQL yourself and I'll
  finish it.
- **Stripe billing/payments (#20)** → Stripe secret key + a `stripe` edge
  function.
- **AI features (#21, #22)** → Anthropic API key + an `ai` edge function.
- **Customer portal / PWA (#23)** → a public web deploy (Vercel/Netlify).
  PWA service worker intentionally deferred: a bad cache config can serve
  a stale app to live users, so I won't add it without you watching.
