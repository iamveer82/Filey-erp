-- Chat channels the agent can configure ITSELF.
--
-- Channel credentials used to live only in Deno.env, which an edge function
-- cannot write — so adding Telegram meant an admin setting four secrets by
-- hand. With the config here, the agent can be told "set up Telegram" on a
-- channel that already works and wire the new one up on the spot.
--
-- These rows hold bot tokens, so there is NO grant to anon/authenticated at
-- all: only the service role (the channel-webhook function) ever touches them.
-- The desktop app doesn't need to read them — it reads channel_messages.
--
-- Idempotent. Run once:
--   supabase db execute --file supabase/2026-08-13-agent-channels.sql
create table if not exists public.agent_channels (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('telegram', 'whatsapp', 'slack')),
  -- Per-provider secrets: telegram {bot_token, webhook_secret},
  -- whatsapp {token, phone_number_id, verify_token, app_secret},
  -- slack {bot_token, signing_secret}.
  credentials jsonb not null default '{}'::jsonb,
  -- Who is allowed to talk to it on this channel: chat id / phone / slack uid.
  -- Null until the owner sends the first message, which is what pairs them.
  owner_ref text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.agent_channels enable row level security;
-- No policy and no grants: service-role only, by design. A policy would be
-- misleading here — nothing else is allowed to read a bot token.
revoke all on public.agent_channels from anon, authenticated;
