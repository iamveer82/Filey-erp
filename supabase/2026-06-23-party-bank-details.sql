-- ============================================================
--  Per-customer / per-supplier bank details
--  Run in: Supabase Dashboard -> SQL Editor -> New query
--  Safe to re-run (add column if not exists). Local SQLite needs no
--  migration — rows are stored as JSON.
-- ============================================================

alter table crm_customers add column if not exists bank_details jsonb;
alter table suppliers     add column if not exists bank_details jsonb;
