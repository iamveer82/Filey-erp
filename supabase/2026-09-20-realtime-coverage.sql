-- Publish missing app collections. No row changes, new grants or policy changes.
-- Apply after the dated feature migrations; RLS still filters readable records.
begin;
do $$ declare t text; begin
  foreach t in array array[
    'crm_people','crm_notes','crm_tasks','user_assets','user_files','user_folders',
    'org_channels','payment_receipts','entity_links','invoice_recurrence',
    'email_messages','call_logs','email_optouts','campaigns'
  ] loop
    if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity) then
      raise exception 'Realtime requires an existing RLS-protected table: %',t;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;
commit;
