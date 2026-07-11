-- ============================================================
--  Filey ERP — cloud/repo schema sync with the local desktop app
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).  APPLIED to live cloud 2026-07-11.
--
--  The local (desktop) app's data model had drifted ahead of the cloud
--  schema. Two classes of drift, both fixed here:
--
--  1. Quantity columns were integer-only (bigint) but the app stores
--     FRACTIONAL quantities (e.g. 50.58 L of oil). purchase_order_items
--     and stock_movements were already numeric(14,3); these three were not.
--     Widening bigint -> numeric(14,3) is lossless.
--
--  2. invoice_docs was missing columns the app writes: show_bank and
--     advance_applied (show_logo/show_stamp/show_signature live in
--     invoice-missing-columns.sql). Added nullable / with app defaults.
-- ============================================================

-- 1. fractional quantities
alter table products    alter column quantity      type numeric(14,3);
alter table products    alter column reorder_level type numeric(14,3);
alter table order_items alter column quantity      type numeric(14,3);

-- 2. invoice_docs columns the desktop app writes
alter table invoice_docs add column if not exists show_logo       boolean not null default false;
alter table invoice_docs add column if not exists show_bank       boolean not null default false;
alter table invoice_docs add column if not exists advance_applied numeric;
