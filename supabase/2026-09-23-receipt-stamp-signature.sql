-- Stamp/signature overlays on payment receipts.
-- The editor holds StampSig {data,x,y} per document; without these columns
-- the save path silently dropped them (PaymentReceipt stripped them with `as any`).
-- Safe to re-run. Additive only — no business rows are rewritten.

begin;

alter table public.payment_receipts add column if not exists stamp jsonb;
alter table public.payment_receipts add column if not exists signature jsonb;

commit;
