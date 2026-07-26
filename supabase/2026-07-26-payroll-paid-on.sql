-- 2026-07-26: record WHEN a salary was actually paid.
--
-- Idempotent: safe to re-run.
--
-- payroll carried only status ('pending' | 'paid'), so the employee history
-- could say a month was paid but never when. updated_at was the closest thing,
-- and it moves on any edit, so it can't be trusted as a payment date.

alter table payroll add column if not exists paid_on date;

-- Backfill: for rows already marked paid, updated_at is the best evidence we
-- have of the payment date. Only fills rows that have no date yet.
update payroll
set paid_on = updated_at::date
where status = 'paid' and paid_on is null;

create index if not exists payroll_employee_period_idx on payroll (employee_id, period);
