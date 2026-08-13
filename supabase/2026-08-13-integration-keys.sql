-- Bring-your-own integration keys for cloud users.
--
-- The desktop app can hold a Composio key because Rust has an encrypted store.
-- A browser has nowhere safe to put one, so web users were stuck on Filey's
-- platform key. This table is the browser's answer: the key is written once and
-- never read back.
--
-- The guarantee is column-level, not RLS. RLS decides which ROWS you see; it
-- cannot hide a column. So `authenticated` is granted select on everything
-- EXCEPT api_key — meaning an XSS holding a live session can learn that a key
-- exists and delete it, but cannot exfiltrate it. Only the service role (the
-- `integrations` edge function) can read the secret, and it only ever sends it
-- to the provider it belongs to.
--
-- Idempotent. Run once:
--   supabase db execute --file supabase/2026-08-13-integration-keys.sql
create table if not exists public.integration_keys (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('composio', 'zernio')),
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.integration_keys enable row level security;

drop policy if exists integration_keys_own on public.integration_keys;
create policy integration_keys_own on public.integration_keys for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Start from nothing, then hand back only what the browser legitimately needs.
revoke all on public.integration_keys from anon, authenticated;
grant select (user_id, provider, created_at, updated_at)
  on public.integration_keys to authenticated;
grant insert (user_id, provider, api_key)
  on public.integration_keys to authenticated;
grant update (api_key, updated_at)
  on public.integration_keys to authenticated;
grant delete on public.integration_keys to authenticated;
