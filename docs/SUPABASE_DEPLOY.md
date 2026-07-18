# Filey ERP — Supabase Deployment Guide

## 1. Create Supabase Project
1. Go to https://supabase.com → New Project
2. Set name: `filey-erp`
3. Set database password (save it!)
4. Choose region: `Southeast Asia (Singapore)` or `West Europe` (closest to UAE)
5. Wait for project to provision (~2 min)

## 2. Get API Keys
- Go to Settings → API
- Copy `Project URL` → `VITE_SUPABASE_URL`
- Copy `anon public` key → `VITE_SUPABASE_ANON_KEY`
- Put both in `.env` file

## 3. Apply Migrations
Run these in Supabase SQL Editor in order:

```bash
# Or use Supabase CLI:
# supabase db push
```

Migration files in order:
1. `supabase/schema.sql` — base schema (tables, RLS, policies)
2. `supabase/customer-portal.sql`
3. `supabase/follow-ups.sql`
4. `supabase/recurring-invoices.sql`
5. `supabase/stripe-billing.sql`
6. `supabase/tool-jobs.sql`
7. `supabase/po-payments-migration.sql`
8. `supabase/invoice-doc-type.sql`
9. `supabase/customers-trn.sql`
10. `supabase/billing-columns-lockdown.sql`
11. `supabase/product-missing-columns.sql`
12. `supabase/invoice-missing-columns.sql`
13. `2026-06-16-accounting-invoice-link.sql`
14. `2026-06-16-customer-missing-columns.sql`
15. `2026-06-16-sms-otp-templates.sql`
16. `2026-06-17-doc-unification.sql`
17. `2026-06-23-party-bank-details.sql`
18. `2026-06-24-uae-einvoice-fields.sql`
19. `2026-06-24-user-folders.sql`
20. `2026-06-25-emirate-code-remap.sql`
21. `2026-06-29-channel-messages.sql`
22. `2026-06-30-audit-trail-hardening.sql`
23. `2026-07-01-invoice-fx-rate.sql`
24. `2026-07-08-licensing.sql`
25. `2026-07-08-org-devices.sql`
26. `2026-07-08-stock-movements.sql`
27. `2026-07-09-agent-pending-actions.sql`
28. `2026-07-09-rls-payment-tables.sql`
29. `2026-07-10-sync-state.sql`
30. `2026-07-11-function-grants-hardening.sql`
31. `2026-07-11-schema-sync-local-drift.sql`
32. `2026-07-11-txn-reconciled.sql`
33. `2026-07-12-vyapar-parity-fields.sql`

## 4. Deploy Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link project
supabase link --project-ref YOUR_PROJECT_REF

# Deploy functions
supabase functions deploy stripe --no-verify-jwt
supabase functions deploy send-email --no-verify-jwt
supabase functions deploy overdue-reminders --no-verify-jwt
supabase functions deploy agent-jobs --no-verify-jwt
supabase functions deploy run-tool --no-verify-jwt
supabase functions deploy channel-webhook --no-verify-jwt
```

## 5. Set Secrets

```bash
# Stripe billing
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
supabase secrets set STRIPE_PRICE_PRO=price_xxx
supabase secrets set STRIPE_PRICE_BUSINESS=price_xxx
supabase secrets set STRIPE_PRICE_LITE=price_xxx        # one-time Offline (desktop) license price

# Licensing — ECDSA P-256 PRIVATE key (PEM) used by the stripe edge function
# to sign Offline-license tokens. Its public half is embedded in
# src/lib/license.ts. Generate once and store ONLY here:
#   openssl ecparam -genkey -name prime256v1 -noout -out license-signing.pem
#   supabase secrets set LICENSE_SIGNING_KEY="$(cat license-signing.pem)"
supabase secrets set LICENSE_SIGNING_KEY="-----BEGIN PRIVATE KEY-----..."

# Email (Resend)
supabase secrets set RESEND_API_KEY=re_xxx

# AI features
supabase secrets set OPENAI_API_KEY=sk-xxx

# App URL
supabase secrets set SITE_URL=https://app.fileyerp.com
```

## 6. Configure Auth
- Go to Authentication → Providers
- Enable Email (already on)
- Enable Google OAuth (optional):
  - Get credentials from Google Cloud Console
  - Set redirect URL from Supabase
- Set Site URL to your app URL
- Add email templates for welcome, reset, OTP

## 7. Set Up Scheduled Jobs
- Go to Database → Scheduled Functions (pg_cron)
- Create `overdue-reminders` cron:
  ```sql
  select cron.schedule(
    'daily-overdue-reminders',
    '0 9 * * *',  -- 9 AM daily
    $$select net.http_post(
      url := 'https://YOUR_PROJECT.functions.supabase.co/overdue-reminders',
      headers := jsonb_build_object('Content-Type', 'application/json')
    )$$
  );
  ```

## 8. Enable Database Backups
- Go to Settings → Database
- Enable Point-in-Time Recovery (PITR) — keeps 30 days
- Or use daily snapshots (free tier)

## 9. Run RLS Verification
- Open `supabase/verify-rls.sql` in SQL Editor
- Run it
- Every table should show PASS
- Fix any FAIL before going live

## 10. Test Connectivity
```bash
# In Filey ERP .env:
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-key

# Run dev mode
npm run dev

# Create an account, verify data saves to Supabase
```