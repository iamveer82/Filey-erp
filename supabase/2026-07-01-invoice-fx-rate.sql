-- 2026-07-01 — Multi-currency: freeze an FX rate on invoices
--
-- fx_rate = AED per 1 unit of the invoice currency, captured the first time a
-- non-AED invoice is saved (see billing.saveDoc). Lets the app show a stable
-- AED-equivalent under the total instead of re-converting at live rates.
-- Idempotent. Run in Supabase Dashboard -> SQL Editor.
alter table public.invoice_docs add column if not exists fx_rate numeric;
