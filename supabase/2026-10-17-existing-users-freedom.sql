-- One-off, run once at the plan change (2026-10): every account that exists today gets Freedom
-- (lifetime Filey Local) free, as thanks for being early. The owner's account keeps its own
-- Enterprise setup and is left out. Paid cloud plans are untouched: a Pro workspace keeps Pro
-- and gets Freedom on top. Accounts made after this ran start the 14-day trial instead.
-- Idempotent: an account that already holds an active licence is skipped.
begin;

insert into public.licenses (user_id, product, status)
select u.id, 'filey-desktop', 'active'
from auth.users u
where lower(u.email) <> 'iamvirendra07@gmail.com'
  and not exists (select 1 from public.licenses l where l.user_id = u.id and l.status = 'active');

commit;
