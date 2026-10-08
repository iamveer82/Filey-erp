-- Audit business values without duplicating multi-megabyte document artwork.
-- Source documents retain their original images. Existing audit rows are kept.
begin;

create or replace function public.filey_audit_snapshot(p_row jsonb)
returns jsonb language sql immutable strict parallel safe set search_path = public as $$
  select coalesce(jsonb_object_agg(key,
    case when key in ('logo','stamp','signature') then
      case when octet_length(value::text) > 8192 then
        jsonb_build_object('_filey_audit_artwork', true,
          'sha256', encode(sha256(convert_to(value::text, 'UTF8')), 'hex'),
          'bytes', octet_length(value::text), 'json_type', jsonb_typeof(value))
      else value end
    else value end), '{}'::jsonb)
  from jsonb_each(p_row);
$$;
-- This is an internal transform, not a client RPC. log_audit's existing owner
-- calls it with its existing definer authority.
revoke all on function public.filey_audit_snapshot(jsonb) from public, anon, authenticated;

create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_name text;
  rid text;
  diff jsonb;
  old_j jsonb;
  new_j jsonb;
begin
  begin
    select coalesce(name, email, 'system') into actor_name
      from public.profiles where id = auth.uid();

    if TG_OP = 'DELETE' then
      rid := old.id::text;
      diff := jsonb_build_object('_deleted', public.filey_audit_snapshot(to_jsonb(old)));
    elsif TG_OP = 'INSERT' then
      rid := new.id::text;
      diff := jsonb_build_object('_created', public.filey_audit_snapshot(to_jsonb(new)));
    else
      rid := new.id::text;
      old_j := public.filey_audit_snapshot(to_jsonb(old));
      new_j := public.filey_audit_snapshot(to_jsonb(new));
      select coalesce(jsonb_object_agg(n.key,
        jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
        into diff
        from jsonb_each(new_j) n left join jsonb_each(old_j) o using (key)
        where n.value is distinct from o.value and n.key <> 'updated_at';
      if diff = '{}'::jsonb then return new; end if;
    end if;

    insert into public.audit_log (actor, action, entity, details, changes, org_id, user_id)
    values (coalesce(actor_name, 'system'), lower(TG_OP), TG_TABLE_NAME,
      TG_TABLE_NAME || ' #' || coalesce(rid, '?'), diff, public.current_org(), auth.uid());
  exception when others then
    null; -- Preserve existing non-blocking audit behavior; cancellation is not swallowed.
  end;
  if TG_OP = 'DELETE' then return old; else return new; end if;
end $$;

-- CREATE OR REPLACE preserves log_audit's owner, ACL and existing trigger links.
notify pgrst, 'reload schema';
commit;
