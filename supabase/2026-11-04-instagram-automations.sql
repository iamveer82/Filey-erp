-- ============================================================
-- Instagram comment-to-DM automation (direct Meta Graph API)
-- ------------------------------------------------------------
-- Keyword → private DM ("OpenReply, built in") driven entirely by
-- Filey's Meta app: comments, live comments, story replies and story
-- mentions arrive at the `instagram-webhook` edge function; matching
-- active rows in ig_automations trigger a private reply through the
-- customer's own professional account.
--
-- Everything here is service-role only: the desktop app never touches
-- these tables directly. It talks to the `instagram` edge function,
-- which checks org membership + the marketing module and then performs
-- reads/writes with the service role. Tokens never reach the client.
--
-- Run once (idempotent):
--   supabase db execute --file supabase/2026-11-04-instagram-automations.sql
-- Pairs with: supabase/functions/instagram-webhook, .../instagram-auth,
--             .../instagram, .../ig-track, src/lib/instagram.ts,
--             src/components/InstagramDmPanel.tsx
-- ============================================================

-- One row per connected professional account (an org can hold several).
create table if not exists public.ig_connections (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  ig_user_id text not null unique,
  ig_username text not null default '',
  account_type text not null default '',        -- BUSINESS | MEDIA_CREATOR
  access_token text not null,                   -- long-lived (60 days); refreshed via ig_exchange_token
  token_expires_at timestamptz,                 -- null = unknown (legacy); we treat < now() as expired
  connected_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ig_connections_org on public.ig_connections (org_id, created_at);

-- Automations: the keyword → DM rule set.
create table if not exists public.ig_automations (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  connection_id uuid not null references public.ig_connections(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  trigger_type text not null
    check (trigger_type in ('comment','live_comment','story_reply','story_mention')),
  keywords text[] not null default '{}',
  exclude_keywords text[] not null default '{}',
  match_mode text not null default 'word' check (match_mode in ('exact','word','contains')),
  typo_tolerance boolean not null default false,
  platform_post_id text,                         -- null = any post / any story
  dm_message text not null check (length(btrim(dm_message)) between 1 and 1000),
  dm_message_variations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(dm_message_variations) = 'array' and jsonb_array_length(dm_message_variations) <= 5),
  buttons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(buttons) = 'array' and jsonb_array_length(buttons) <= 3),
  dm_delay_seconds integer not null default 0 check (dm_delay_seconds between 0 and 86400),
  comment_reply text check (comment_reply is null or length(btrim(comment_reply)) between 1 and 1000),
  comment_reply_variations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(comment_reply_variations) = 'array' and jsonb_array_length(comment_reply_variations) <= 5),
  comment_reply_delay_seconds integer not null default 0 check (comment_reply_delay_seconds between 0 and 86400),
  public_reply_policy text not null default 'after_dm' check (public_reply_policy in ('after_dm','always')),
  follow_gate boolean not null default false,
  also_match_in_dms boolean not null default false,
  repeat_mode text not null default 'once' check (repeat_mode in ('once','every_comment')),
  cooldown_hours integer check (cooldown_hours is null or cooldown_hours between 1 and 720),
  dedupe_same_text_hours integer check (dedupe_same_text_hours is null or dedupe_same_text_hours between 0 and 720),
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ig_automations_org on public.ig_automations (org_id, created_at desc);
create index if not exists ig_automations_match
  on public.ig_automations (org_id, trigger_type, is_active);

-- Dedupe of redelivered Meta events (comment id / message mid).
create table if not exists public.ig_seen_events (
  key text primary key,                          -- 'comment:<id>' | 'mid:<id>'
  org_id text,                                   -- null until a known connection matches
  received_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists ig_seen_events_expires on public.ig_seen_events (expires_at);

-- Tracked links, one row per URL button of an automation.
create table if not exists public.ig_tracked_links (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  automation_id uuid not null references public.ig_automations(id) on delete cascade,
  button_index integer not null check (button_index between 0 and 2),
  target_url text not null check (target_url ~ '^https?://'),
  tracked boolean not null default true,
  clicks integer not null default 0 check (clicks >= 0),
  created_at timestamptz not null default now(),
  unique (automation_id, button_index)
);
create index if not exists ig_tracked_links_org on public.ig_tracked_links (org_id);

-- Automation event log: what fired, what was skipped, what failed.
create table if not exists public.ig_events (
  id bigint generated by default as identity primary key,
  org_id text not null,
  automation_id uuid references public.ig_automations(id) on delete set null,
  -- Cascade: disconnecting an account removes its activity log (commenter ids/usernames).
  connection_id uuid references public.ig_connections(id) on delete cascade,
  kind text not null check (kind in
    ('dm_sent','dm_skipped','public_reply','public_reply_failed','follow_gate_prompt','follow_gate_unlock','follow_gate_declined','error')),
  actor_igsid text,
  actor_username text,
  comment_id text,
  mid text,
  message_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ig_events_org_created on public.ig_events (org_id, created_at desc);
create index if not exists ig_events_actor on public.ig_events (automation_id, actor_igsid, kind, created_at desc);
create index if not exists ig_events_hourly on public.ig_events (connection_id, kind, created_at desc);

-- Click log (aggregate lives on ig_tracked_links.clicks).
create table if not exists public.ig_link_clicks (
  id bigint generated by default as identity primary key,
  link_id uuid not null references public.ig_tracked_links(id) on delete cascade,
  org_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists ig_link_clicks_link on public.ig_link_clicks (link_id, created_at desc);

-- Short-lived OAuth state for the connect flow (start → callback).
create table if not exists public.ig_oauth_states (
  state text primary key,                         -- random 32-byte hex
  org_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);
create index if not exists ig_oauth_states_expires on public.ig_oauth_states (expires_at);

alter table public.ig_connections enable row level security;
alter table public.ig_automations enable row level security;
alter table public.ig_seen_events enable row level security;
alter table public.ig_tracked_links enable row level security;
alter table public.ig_events enable row level security;
alter table public.ig_link_clicks enable row level security;
alter table public.ig_oauth_states enable row level security;

-- No client policies: everything happens through the edge functions with the
-- service role, which bypasses RLS. A tampered client can neither read tokens
-- nor forge automation events.
revoke all on public.ig_connections from public, anon, authenticated;
revoke all on public.ig_automations from public, anon, authenticated;
revoke all on public.ig_seen_events from public, anon, authenticated;
revoke all on public.ig_tracked_links from public, anon, authenticated;
revoke all on public.ig_events from public, anon, authenticated;
revoke all on public.ig_link_clicks from public, anon, authenticated;
revoke all on public.ig_oauth_states from public, anon, authenticated;

grant all on public.ig_connections to service_role;
grant all on public.ig_automations to service_role;
grant all on public.ig_seen_events to service_role;
grant all on public.ig_tracked_links to service_role;
grant all on public.ig_events to service_role;
grant all on public.ig_link_clicks to service_role;
grant all on public.ig_oauth_states to service_role;
