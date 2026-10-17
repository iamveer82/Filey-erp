-- Basic = a 14-day trial, per account AND per device, plus a one-time $1 Filey AI welcome credit.
-- The trial window comes from the account's creation date; a device keeps the window of the
-- first account that trialled on it, so a new email on the same computer starts no new trial.
-- Only the dodo edge function (service role) reads or writes these.
begin;

create table if not exists public.app_trials (
  fingerprint text primary key check (length(fingerprint) between 8 and 256),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now()
);
create index if not exists app_trials_user on public.app_trials(user_id);
alter table public.app_trials enable row level security;
revoke all on public.app_trials from public, anon, authenticated;
grant all on public.app_trials to service_role;

-- $1 of Coins once per account. The ledger's unique event key makes a retry or a second
-- device a no-op; the balance moves only when the ledger row is new.
create or replace function public.filey_ai_welcome_credit(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare added integer;
begin
  insert into ai_credit_accounts(user_id) values (p_user) on conflict (user_id) do nothing;
  perform 1 from ai_credit_accounts where user_id = p_user for update;
  insert into ai_credit_ledger(user_id, event_key, kind, amount_micros, description)
    values (p_user, 'welcome:' || p_user, 'topup', 1000000, 'Welcome credit')
    on conflict (event_key) do nothing;
  get diagnostics added = row_count;
  if added = 0 then return false; end if;
  update ai_credit_accounts set balance_micros = balance_micros + 1000000, updated_at = now() where user_id = p_user;
  return true;
end $$;
revoke all on function public.filey_ai_welcome_credit(uuid) from public, anon, authenticated;
grant execute on function public.filey_ai_welcome_credit(uuid) to service_role;

commit;
