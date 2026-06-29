-- ============================================================
-- Channel relay: channel_messages (inbound/outbound log + queue)
-- ------------------------------------------------------------
-- Spine of the "hosted relay" personal-agent feature. The
-- channel-webhook edge function (service-role) writes both
-- directions here; the desktop app reads its own rows live via
-- the existing realtime channel (lib/realtime.ts) to show the
-- conversation.
--
-- Run once (idempotent):
--   supabase db execute --file supabase/2026-06-29-channel-messages.sql
-- Pairs with: supabase/functions/channel-webhook
-- ============================================================

create table if not exists public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,                  -- telegram | whatsapp | slack | ...
  external_id text not null default '',   -- chat id / sender handle
  direction text not null,                -- 'in' | 'out'
  body text not null default '',
  raw jsonb not null default '{}'::jsonb,  -- full provider payload, for audit
  created_at timestamptz not null default now()
);

alter table public.channel_messages enable row level security;

-- Owner reads their own conversation. Writes only ever come from the
-- service-role webhook (which bypasses RLS), so no insert/update policy
-- is granted to clients — a tampered client can't forge inbound traffic.
drop policy if exists channel_messages_own on public.channel_messages;
create policy channel_messages_own on public.channel_messages for select
  to authenticated
  using (user_id = auth.uid());

create index if not exists idx_channel_messages_user_created
  on public.channel_messages (user_id, created_at desc);

-- Live conversation in the desktop app (RLS still scopes per user).
do $$
begin
  begin
    alter publication supabase_realtime add table public.channel_messages;
  exception when others then null;
  end;
end $$;
