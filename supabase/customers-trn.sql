-- Add a dedicated TRN (tax registration number) column to customers so it
-- can be stored properly and pulled onto invoices/quotations. Idempotent.
-- Run once: supabase db execute --file supabase/customers-trn.sql
alter table public.crm_customers add column if not exists trn text;
