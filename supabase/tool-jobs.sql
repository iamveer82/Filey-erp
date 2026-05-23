-- ============================================================
-- Server-side tool pipeline: tool_jobs + tool-inputs bucket
-- ------------------------------------------------------------
-- Run once against your Supabase project (SQL editor or
--   supabase db execute --file supabase/tool-jobs.sql
-- ). Idempotent. Pairs with the `run-tool` edge function.
--
-- Flow: client uploads a source file to the private tool-inputs
-- bucket, inserts a tool_jobs row, then either invokes the
-- run-tool edge function (engine='edge', light pdf-lib tools) or
-- lets a self-hosted worker pick the job up (engine='worker',
-- heavy tools: OCR / Office<->PDF / PDF-A). Outputs land in the
-- existing tool-outputs bucket.
-- ============================================================

create table if not exists public.tool_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tool text not null,
  status text not null default 'pending',   -- pending | processing | done | error
  engine text not null default 'edge',      -- edge | worker
  input_path text not null,
  output_paths text[] not null default '{}',
  params jsonb not null default '{}'::jsonb,
  file_name text not null default '',
  size_bytes bigint not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tool_jobs enable row level security;

drop policy if exists tool_jobs_own on public.tool_jobs;
create policy tool_jobs_own on public.tool_jobs for all
  to authenticated
  using (user_id = auth.uid())
  -- input_path must live under the caller's own storage folder, so a
  -- tampered path can't make the (service-role) worker read another
  -- user's files.
  with check (
    user_id = auth.uid()
    and input_path like (auth.uid()::text || '/%')
  );

create index if not exists idx_tool_jobs_user_created
  on public.tool_jobs (user_id, created_at desc);
create index if not exists idx_tool_jobs_status on public.tool_jobs (status);

-- Let the client subscribe to its own job status changes (optional).
do $$
begin
  begin
    alter publication supabase_realtime add table public.tool_jobs;
  exception when others then null;
  end;
end $$;

-- ----- STORAGE: tool-inputs bucket (private, per-user folders) -----
insert into storage.buckets (id, name, public)
values ('tool-inputs', 'tool-inputs', false)
on conflict (id) do nothing;

drop policy if exists tool_inputs_read on storage.objects;
create policy tool_inputs_read on storage.objects for select
  to authenticated
  using (
    bucket_id = 'tool-inputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists tool_inputs_insert on storage.objects;
create policy tool_inputs_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tool-inputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists tool_inputs_update on storage.objects;
create policy tool_inputs_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'tool-inputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'tool-inputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists tool_inputs_delete on storage.objects;
create policy tool_inputs_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'tool-inputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
