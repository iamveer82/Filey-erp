-- Follow-up recurrence: completing a repeating reminder spawns the next
-- occurrence (daily / weekly / monthly). Additive + idempotent.
alter table public.follow_ups
  add column if not exists repeat text not null default 'none';
