-- Link accounting transactions to invoices so propagation is reversible,
-- idempotent, and auditable. Safe to re-run.
alter table transactions add column if not exists ref text;
alter table transactions add column if not exists source text;
alter table transactions add column if not exists invoice_id bigint references invoice_docs(id) on delete set null;

create index if not exists idx_transactions_invoice_id on transactions(invoice_id);
create index if not exists idx_transactions_ref on transactions(ref);
