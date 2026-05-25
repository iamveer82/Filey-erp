# Filey — things YOU need to do

Running list of setup steps that need your hands (keys, deploys, infra).
The code is built; these activate it. Ask anytime and I'll point you here.

## Outstanding now

- [ ] **Activate Stripe billing** (code is built — `supabase/functions/stripe/`):
      1. `supabase functions deploy stripe --no-verify-jwt`
      2. Set secrets: `supabase secrets set STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… STRIPE_PRICE_PRO=price_… STRIPE_PRICE_BUSINESS=price_… SITE_URL=https://your-domain`
      3. In Stripe → Webhooks, add endpoint
         `https://voyrjqgaypiylwskkwpr.functions.supabase.co/stripe`
         for `checkout.session.completed`, `customer.subscription.updated`,
         `customer.subscription.deleted`; copy its signing secret into
         `STRIPE_WEBHOOK_SECRET`.
      Until then the Billing tab shows plans but checkout returns a friendly
      "not set up yet" message. (DB columns already added to `organizations`.)
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

- [x] **All 7 backlog tasks done (2026-05-25)** — migrations applied with the
      7-day token: org billing columns, `invoice_recurrence`, `share_token` +
      `get_shared_invoice` RPC.
      - #17 recurring invoices + overdue reminder
      - #18 multi-currency · #19 export
      - #20 Stripe billing (edge fn built — activate per "Outstanding")
      - #21 AI doc scan · #22 AI copilot
      - #23 customer portal + PWA
- [x] **AI suite (2026-05-25)** — BYOK copilot (any model), persistent
      multi-chat, onboarding persona, rename/recolour orb, data grounding,
      **tool-use agent** (reads your data + creates draft invoices), doc/receipt
      scanning, daily-briefing card, offline-aware.
- [x] **Get-paid loop (2026-05-25)** — public "Pay now" on shared invoices +
      "View & pay" link in invoice emails (activates with Stripe keys).

- [x] **Security: billing columns locked (2026-05-25)** — only the Stripe
      webhook (service_role) can write the org plan; members can't fake it.
- [x] **Dashboard invoice revenue / collected / outstanding (2026-05-25)**
- [x] **AI actions: create orders, add reminders (2026-05-25)** + create
      customers/products, adjust stock, log expenses, finalize/recur invoices,
      run PDF/image tools on chat attachments.
- [x] **Storage usage meter + Get-started checklist (2026-05-25)**

## Coming — needs YOUR keys/deploy (code is built or trivial)

- **Overdue auto-EMAIL reminders** → code built at
  `supabase/functions/overdue-reminders/`. To activate:
  1. Get a Resend API key (resend.com) + verify a sender domain.
  2. `supabase functions deploy overdue-reminders --no-verify-jwt`
  3. `supabase secrets set RESEND_API_KEY=… REMINDER_FROM="Filey <billing@yourdomain>" SITE_URL=https://your-domain`
  4. Schedule it (pg_cron snippet in the function header) or point any cron at
     its URL. (The in-app overdue nudge already ships.)
- **PWA push notifications** → not built yet; needs a VAPID keypair you
  generate + a subscriptions table + a sender fn. Say the word and I'll scaffold
  it (it's the one piece left that's genuinely optional).
- **Knowledge-graph storage** → the usage *meter* ships; a true per-row graph +
  hard limits would be a server-side enforcement layer (future).
