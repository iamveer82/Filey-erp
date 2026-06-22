-- ============================================================
--  Filey ERP — Missing invoice_docs & invoice_doc_items columns
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent — uses add column if not exists).
--  These columns were added to the app's TypeScript types but
--  the matching DB columns were never captured in schema.sql.
-- ============================================================

-- invoice_docs: stamp & signature (jsonb for {data, x, y, opacity, color, crop*})
alter table invoice_docs add column if not exists stamp jsonb;
alter table invoice_docs add column if not exists signature jsonb;

-- invoice_docs: custom user-defined columns on the invoice
alter table invoice_docs add column if not exists custom_columns jsonb;

-- invoice_docs: optional document title override (e.g. "Proforma Invoice")
alter table invoice_docs add column if not exists doc_title text;

-- invoice_docs: PO number for purchase-order references
alter table invoice_docs add column if not exists po_number text;

-- invoice_doc_items: unit of measure (e.g. L, kg, pcs, MT)
alter table invoice_doc_items add column if not exists unit text;

-- invoice_doc_items: per-item custom field values (map of column key → value)
alter table invoice_doc_items add column if not exists custom jsonb;

-- show/hide toggles for stamp & signature per document
alter table invoice_docs add column if not exists show_stamp boolean not null default false;
alter table invoice_docs add column if not exists show_signature boolean not null default false;
alter table quotations add column if not exists show_stamp boolean not null default false;
alter table quotations add column if not exists show_signature boolean not null default false;
alter table purchase_orders add column if not exists show_stamp boolean not null default false;
alter table purchase_orders add column if not exists show_signature boolean not null default false;

-- show/hide toggle for the logo per invoice (default off — opt in per document)
alter table invoice_docs add column if not exists show_logo boolean not null default false;
