-- Quotations get the round-off switch invoices already had.
--
-- Without the column the editor could show the toggle but never persist it, so
-- a quote reopened (or converted to an invoice) would quietly revert to the
-- unrounded total — the customer sees one number on the PDF and another on the
-- invoice that follows it.
--
-- Idempotent. Run once:
--   supabase db execute --file supabase/2026-08-13-quotation-round-off.sql
alter table public.quotations
  add column if not exists round_off boolean not null default false;
