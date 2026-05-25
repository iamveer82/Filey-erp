-- Document type on invoices (Tax Invoice / Proforma / Purchase Order / …).
-- Free-text so users can pick a preset or type their own. Additive.

alter table invoice_docs add column if not exists doc_type text not null default 'Tax Invoice';
