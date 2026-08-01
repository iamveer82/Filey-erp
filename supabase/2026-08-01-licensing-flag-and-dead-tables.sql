-- 2026-08-01 — two loose ends found while auditing enforcement + schema drift.
-- NOT yet applied to live (the ~/.filey management PAT is expired). Run the
-- parts below in the Supabase SQL editor, in order, reading each first.
--
-- Context for both:
--   * The CLIENT licensing flag is already on (src/lib/license.ts ENFORCE_LICENSING = true).
--   * The 2026-06-24 UAE e-invoice migration is confirmed applied to live — no drift.


-- ── PART 1 — turn on the server-side half of licensing ───────────────────────
-- The free-invoice-cap trigger (2026-07-18-free-invoice-cap.sql) is gated by
-- this flag, which that migration seeds as 'false'. While it stays false the
-- 25-invoice free cap is enforced by the client only, so anyone driving the
-- REST API directly is uncapped. Check the current value first:

select key, value from public.platform_config where key = 'licensing_enforced';

-- Then, if it reads 'false' and you want the server to enforce the cap:

-- update public.platform_config set value = 'true' where key = 'licensing_enforced';


-- ── PART 2 — the six dead tables ─────────────────────────────────────────────
-- custom_entity_fields, custom_entity_values, sms_providers, sms_templates,
-- sms_logs and otp_codes were created by 2026-06-16-sms-otp-templates.sql with
-- a policy of `org_id = current_org_id()`, where current_org_id() reads the GUC
-- `app.current_org_id` that the browser client never sets — so it returns NULL
-- and every client row is denied.
--
-- That was logged as a bug, but nothing in src/ or supabase/functions/ reads or
-- writes these tables: custom fields live in app_settings plus a custom_fields
-- JSONB column (src/lib/customFields.ts), and the SMS/OTP feature was never
-- wired up. Verified against live on 2026-08-01: anon SELECT returns [] and anon
-- INSERT returns 42501 — fail-closed both ways, so this is dead weight rather
-- than a security hole. Nothing is broken for users by leaving it alone.
--
-- Confirm they are empty before dropping anything:

select 'custom_entity_fields' as t, count(*) from public.custom_entity_fields
union all select 'custom_entity_values', count(*) from public.custom_entity_values
union all select 'sms_providers',        count(*) from public.sms_providers
union all select 'sms_templates',        count(*) from public.sms_templates
union all select 'sms_logs',             count(*) from public.sms_logs
union all select 'otp_codes',            count(*) from public.otp_codes;

-- If every count is 0 and you don't intend to build SMS/OTP soon, drop them.
-- Re-creating them later is just re-running the original migration with the
-- correct `org_id = public.current_org()` policy and a force_org_id() trigger.

-- drop table if exists public.custom_entity_values;
-- drop table if exists public.custom_entity_fields;
-- drop table if exists public.sms_logs;
-- drop table if exists public.sms_templates;
-- drop table if exists public.sms_providers;
-- drop table if exists public.otp_codes;
-- drop function if exists public.current_org_id();
