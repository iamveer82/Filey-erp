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

## Coming (will be added as features land)

- Stripe billing/payments → Stripe secret key + a `stripe` edge function.
- AI features → Anthropic API key + an `ai` edge function.
- Customer portal / PWA → a public web deploy (Vercel/Netlify).
