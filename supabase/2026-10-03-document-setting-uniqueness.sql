-- Apply after Packaging and Letters. Old bootstrap databases generated the
-- name app_settings_user_id_key_key for UNIQUE(user_id,key). Name-only drops
-- missed that constraint and blocked one user's documents in a second org.
-- Replace only that unconditional pair, regardless of its legacy name.
-- No setting values, ownership, module gates or RLS policies are changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.app_settings in access exclusive mode;

drop index if exists public.app_settings_user_setting_key;
create unique index app_settings_user_setting_key
  on public.app_settings(user_id,key) where key not in ('packaging_lists','letters');
create unique index if not exists app_settings_packaging_org_key
  on public.app_settings(org_id,key) where key='packaging_lists';
create unique index if not exists app_settings_letters_org_key
  on public.app_settings(org_id,key) where key='letters';

do $$ declare v_name text; begin
  -- Drop a constraint through ALTER TABLE so its backing index is removed too.
  -- No CASCADE: an unexpected dependent object must abort this transaction.
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid='public.app_settings'::regclass and c.contype='u'
      and (select array_agg(a.attname::text order by a.attname::text)
        from unnest(c.conkey) col(attnum)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=col.attnum)
        =array['key','user_id']::text[]
  loop
    execute format('alter table public.app_settings drop constraint %I',v_name);
  end loop;

  -- Some installations kept the same pair as a standalone unique index.
  for v_name in
    select idx.relname from pg_index i join pg_class idx on idx.oid=i.indexrelid
    where i.indrelid='public.app_settings'::regclass and i.indisunique
      and i.indpred is null and i.indnkeyatts=2
      and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
      and (select array_agg(a.attname::text order by a.attname::text)
        from unnest(i.indkey) with ordinality col(attnum,ordinality)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=col.attnum
        where col.ordinality<=i.indnkeyatts)=array['key','user_id']::text[]
  loop
    execute format('drop index public.%I',v_name);
  end loop;
end $$;

notify pgrst,'reload schema';
commit;
