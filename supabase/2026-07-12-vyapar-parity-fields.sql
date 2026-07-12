-- Vyapar-parity fields (2026-07-12).
-- Invoice: payment-terms preset, buyer PO date, UAE date of supply.
-- Customer: credit limit + opening balance (AED; opening balance positive =
-- receivable from customer, negative = payable to them).
-- Idempotent — safe to re-run.

alter table invoice_docs add column if not exists payment_terms text;
alter table invoice_docs add column if not exists po_date date;
alter table invoice_docs add column if not exists date_of_supply date;

alter table crm_customers add column if not exists credit_limit numeric(14,2);
alter table crm_customers add column if not exists opening_balance numeric(14,2);
