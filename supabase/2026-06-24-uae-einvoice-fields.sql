-- ============================================================
--  Filey ERP — UAE Electronic Invoice mandatory fields
--  Ref: "UAE Electronic Invoice Mandatory Fields" v1.0 (23 Feb 2026),
--       Peppol PINT-AE. Captures the fields not already covered by the
--       existing invoice model so data accrues ahead of the phased mandate.
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent — add column if not exists).
--  NOTE: local/offline mode (localdb.ts) is schemaless — no change needed there.
-- ============================================================

-- invoice_docs: fields that vary per document --------------------------------
-- Invoice type code: functional type, e.g. 380 (tax invoice), 381 (credit note).
alter table invoice_docs add column if not exists invoice_type_code text;
-- Transaction type code: 8-flag bitstring, order per spec §4.1 field 5:
--   FreeZone, DeemedSupply, MarginScheme, SummaryInvoice, ContinuousSupply,
--   DisclosedAgentBilling, E-commerce, Exports.  Default "00000000".
alter table invoice_docs add column if not exists transaction_type text;
-- Payment means type code: how payment is settled (e.g. 10 cash, 30 transfer, 48 card).
alter table invoice_docs add column if not exists payment_means_code text;
-- Buyer structured address (snapshot — buyer may be ad-hoc with no CRM record).
alter table invoice_docs add column if not exists buyer_city text;
alter table invoice_docs add column if not exists buyer_country_subdivision text;  -- emirate
alter table invoice_docs add column if not exists buyer_country_code text;         -- default AE

-- Seller identity snapshotted onto the invoice (autofilled from company_profile
-- at creation; frozen on the issued doc for historical accuracy + the XML).
alter table invoice_docs add column if not exists seller_city text;
alter table invoice_docs add column if not exists seller_country_subdivision text;  -- emirate
alter table invoice_docs add column if not exists seller_legal_id text;
alter table invoice_docs add column if not exists seller_legal_id_type text;         -- TL / EID / PAS / CD

-- Corrective documents (credit/debit note 381/383) reference the original invoice.
alter table invoice_docs add column if not exists original_invoice_number text;
alter table invoice_docs add column if not exists original_invoice_date date;
-- Rate to AED for the mandatory VAT-in-accounting-currency total when currency != AED.
alter table invoice_docs add column if not exists aed_exchange_rate numeric;

-- invoice_doc_items: per-line tax category ----------------------------------
-- Tax category code: S standard, Z zero-rated, E exempt, O out-of-scope.
alter table invoice_doc_items add column if not exists tax_category text;

-- company_profile: seller legal registration + location ----------------------
alter table company_profile add column if not exists legal_id text;             -- trade-license / EID / passport / cabinet-decision no.
alter table company_profile add column if not exists legal_id_type text;        -- TL / EID / PAS / CD
alter table company_profile add column if not exists country_subdivision text;  -- emirate

-- crm_customers: buyer location ---------------------------------------------
alter table crm_customers add column if not exists city text;
alter table crm_customers add column if not exists country_subdivision text;    -- emirate
alter table crm_customers add column if not exists country_code text;           -- default AE
