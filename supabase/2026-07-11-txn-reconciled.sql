-- ============================================================
--  Filey ERP — bank reconciliation: persist confirmed matches
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).
--  transactions.reconciled_at is stamped when the user confirms a
--  statement match in Bank Accounts → Reconcile; reconciled entries
--  stay out of later matching pools.
-- ============================================================

alter table transactions add column if not exists reconciled_at timestamptz;
