-- ============================================================
--  Filey ERP — Missing products columns
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent — uses add column if not exists).
--  These columns were added to the app's Inventory UI (New Product
--  form + product list batch/expiry/barcode rendering) but the
--  matching DB columns were never captured in schema.sql, so every
--  "Add product" insert failed with PGRST204 (column not found).
-- ============================================================

alter table products add column if not exists batch_number  text;
alter table products add column if not exists expiry_date   date;
alter table products add column if not exists barcode       text;
alter table products add column if not exists warehouse     text;
alter table products add column if not exists is_serialized boolean not null default false;

-- User-defined custom attributes (map of field name → value), e.g. {"Color":"Red"}
alter table products add column if not exists custom_fields jsonb;
