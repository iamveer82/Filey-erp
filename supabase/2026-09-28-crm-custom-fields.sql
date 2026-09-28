-- Additive only. Definitions use existing workspace-scoped app_settings;
-- values keep the records' existing permissions and sync revision tracking.
begin;
alter table public.crm_leads add column if not exists custom_fields jsonb default '{}';
alter table public.crm_opportunities add column if not exists custom_fields jsonb default '{}';
alter table public.crm_tasks add column if not exists custom_fields jsonb default '{}';
alter table public.crm_notes add column if not exists custom_fields jsonb default '{}';
alter table public.crm_activities add column if not exists custom_fields jsonb default '{}';
notify pgrst, 'reload schema';
commit;
