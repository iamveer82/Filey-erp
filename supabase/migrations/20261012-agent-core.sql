-- agent-core schema (increment 1) — queued execution state + audit
create table if not exists public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid,
  channel text not null default 'app',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.agent_threads(id),
  user_id uuid not null,
  company_id uuid,
  task_type text not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed','dead_letter')),
  attempts integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  next_run_at timestamptz not null default now(),
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_agent_tasks_idempotency
  on public.agent_tasks(idempotency_key) where idempotency_key is not null;

create index if not exists ix_agent_tasks_claim
  on public.agent_tasks(status, next_run_at);

create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.agent_threads(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.agent_tasks(id) on delete cascade,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status text not null default 'ok' check (status in ('ok','error')),
  elapsed_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists public.journal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid,
  source_type text not null,
  source_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);