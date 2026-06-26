-- ============================================================
--  Filey ERP — My Files: user-created folders + file assignment
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).
--  NOTE: local/offline mode (localdb.ts) is schemaless — no change needed there;
--  folder metadata flows through the sb() shim automatically.
-- ============================================================

create table if not exists user_folders (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  parent_id  uuid references user_folders(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists user_folders_owner_idx on user_folders(owner, parent_id);

alter table user_folders enable row level security;
drop policy if exists user_folders_self on user_folders;
create policy user_folders_self on user_folders for all
  using (owner = auth.uid()) with check (owner = auth.uid());

-- Which folder a file lives in (null = root / unfiled). Set null on folder
-- delete so a file is never lost when its folder is removed.
alter table user_files add column if not exists folder_id uuid
  references user_folders(id) on delete set null;
create index if not exists user_files_folder_idx on user_files(owner, folder_id);
