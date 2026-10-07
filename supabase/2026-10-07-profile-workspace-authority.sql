-- Active workspace changes must use the membership-locking switch RPC.
-- A direct profile UPDATE can use a stale statement snapshot after removal.
-- Apply after removed-member workspace recovery; no stored rows are changed.
begin;
do $$ declare v_role text; v_columns text; begin
  -- Table UPDATE overrides a column REVOKE. Preserve the existing grants for
  -- every other column, including limited-grant installations and repeat runs.
  foreach v_role in array array['public','anon','authenticated'] loop
    select string_agg(quote_ident(a.attname),', ' order by a.attnum) into v_columns
      from pg_attribute a join pg_class c on c.oid=a.attrelid
      where a.attrelid='public.profiles'::regclass and a.attnum>0 and not a.attisdropped and a.attname<>'org_id'
        and case when v_role='public' then
          exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
            where acl.grantee=0 and acl.privilege_type='UPDATE')
          or exists(select 1 from aclexplode(a.attacl) acl where acl.grantee=0 and acl.privilege_type='UPDATE')
        else has_column_privilege(v_role,c.oid,a.attnum,'UPDATE') end;
    -- The role names come only from the fixed list above (PUBLIC is a keyword).
    execute format('revoke update on public.profiles from %s',v_role);
    execute format('revoke update (org_id) on public.profiles from %s',v_role);
    if v_columns is not null then
      execute format('grant update (%s) on public.profiles to %s',v_columns,v_role);
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
