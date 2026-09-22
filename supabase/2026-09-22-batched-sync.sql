-- Add a bounded transport wrapper; sync_record remains the authority for
-- authentication, RLS, optimistic revisions and idempotent legacy retries.
begin;
create or replace function public.sync_records(p_table text, p_records jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  item jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Invalid sync batch';
  end if;
  if jsonb_array_length(p_records) > 50 or octet_length(p_records::text) > 8000000 then
    raise exception 'Sync batch is too large';
  end if;
  for item in select value from jsonb_array_elements(p_records) loop
    begin
      result := public.sync_record(p_table, item->'row', (item->>'expected')::bigint);
    exception when others then
      -- Each row gets a savepoint. A broken FK cannot roll back valid siblings.
      -- Do not send SQL details or customer values back in an error message.
      result := jsonb_build_object('ok',false,'error',jsonb_build_object('code',
        case when SQLERRM = 'Sync schema is out of date' then '42703' else SQLSTATE end));
    end;
    results := results || jsonb_build_array(result || jsonb_build_object('id',item->'row'->'id'));
  end loop;
  return results;
end $$;
revoke all on function public.sync_records(text,jsonb) from public,anon;
grant execute on function public.sync_records(text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
