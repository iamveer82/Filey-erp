-- ============================================================
--  Filey ERP — invoice line-item column check
--  Run in:  Supabase Dashboard → SQL Editor → New query
--
--  READ-ONLY. Selects only; creates and changes nothing.
--
--  WHY THIS EXISTS
--  saveDoc writes an invoice's lines with a fixed column list. If the
--  database is missing any one of them, every one of those inserts fails.
--  Until v2.10.2 the old lines had already been deleted by that point, so a
--  missing column silently emptied invoices and left them showing a zero
--  total. v2.10.2 makes a failed save harmless, but the save still fails —
--  the lines just survive it. Run this to find out whether edits are
--  failing, and apply the migration named beside anything missing.
-- ============================================================

-- 1. Which expected columns are absent?
with expected(column_name, added_by) as (
  values
    ('invoice_id',   'schema.sql'),
    ('description',  'schema.sql'),
    ('qty',          'schema.sql'),
    ('unit_price',   'schema.sql'),
    ('position',     'schema.sql'),
    ('unit',         'invoice-missing-columns.sql'),
    ('custom',       'invoice-missing-columns.sql'),
    ('product_id',   'schema.sql (late alter)'),
    ('tax_category', '2026-06-24-uae-einvoice-fields.sql')
)
select
  e.column_name,
  e.added_by                                   as apply_this_migration,
  case when c.column_name is null
       then 'MISSING — invoice edits fail'
       else 'ok' end                           as status
from expected e
left join information_schema.columns c
       on c.table_schema = 'public'
      and c.table_name   = 'invoice_doc_items'
      and c.column_name  = e.column_name
order by (c.column_name is not null), e.column_name;

-- 2. Invoices that currently have no lines at all. Some are legitimately
--    empty drafts; a *sent* or *paid* invoice with zero lines and a customer
--    is the fingerprint of the data loss this check is about.
select
  d.id,
  d.number,
  d.customer_name,
  d.status,
  d.issue_date,
  d.updated_at
from public.invoice_docs d
left join public.invoice_doc_items i on i.invoice_id = d.id
where i.id is null
group by d.id, d.number, d.customer_name, d.status, d.issue_date, d.updated_at
order by d.updated_at desc
limit 100;

-- 3. Count, so the scale is obvious at a glance.
select
  count(*) filter (where i.id is null)                                as invoices_with_no_lines,
  count(*) filter (where i.id is null and d.status <> 'draft')        as non_draft_with_no_lines,
  count(*)                                                            as invoices_total
from public.invoice_docs d
left join lateral (
  select 1 as id from public.invoice_doc_items x where x.invoice_id = d.id limit 1
) i on true;
