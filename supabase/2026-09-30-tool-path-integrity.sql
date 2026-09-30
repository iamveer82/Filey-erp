-- Prefix-only job paths can escape folders when a service-role worker's URL
-- parser normalizes dot segments. Add a restrictive policy without rewriting
-- historical jobs. Unsafe old jobs are also refused by the worker/edge guard.
begin;
create or replace function public.filey_tool_path_owned(p_path text,p_owner uuid)
returns boolean language sql immutable strict set search_path=public,pg_temp as $$
  select length(p_path)<=1024 and split_part(p_path,'/',1)=p_owner::text
    and position('/' in p_path)>0 and position(chr(92) in p_path)=0
    and position('%' in p_path)=0 and position('?' in p_path)=0 and position('#' in p_path)=0
    and p_path !~ '[[:cntrl:]]'
    and not exists(select 1 from unnest(string_to_array(p_path,'/')) segment where segment in ('','.','..'));
$$;
revoke all on function public.filey_tool_path_owned(text,uuid) from public;
grant execute on function public.filey_tool_path_owned(text,uuid) to authenticated,service_role;
do $$ begin
  if to_regclass('public.tool_jobs') is not null then
    drop policy if exists filey_tool_paths_required on public.tool_jobs;
    create policy filey_tool_paths_required on public.tool_jobs as restrictive for all to authenticated
      using(user_id=auth.uid())
      with check(user_id=auth.uid() and public.filey_tool_path_owned(input_path,auth.uid())
        and not exists(select 1 from unnest(output_paths) path where public.filey_tool_path_owned(path,auth.uid()) is not true));
  end if;
end $$;
notify pgrst,'reload schema';
commit;
