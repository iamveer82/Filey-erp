-- Repeatable privacy boundary for hosted files and service-only retention.
-- Apply after the storage buckets/tool_runs features. No object or user data
-- is deleted and existing size/MIME restrictions are preserved.
begin;

-- Public downloads bypass object SELECT RLS. Earlier bucket creation used
-- ON CONFLICT DO NOTHING, which retained a previously public bucket.
update storage.buckets set public=false
where id in ('files','tool-inputs','tool-outputs','team-attachments')
  and public is distinct from false;

-- Managed default grants include authenticated EXECUTE. This definer routine
-- deliberately deletes across owners; only the scheduled/service job may call
-- it. Revoking PUBLIC alone does not remove those explicit client grants.
create or replace function public.prune_tool_runs(max_age interval default '30 days')
returns void language plpgsql security definer
set search_path=public,storage as $$
begin
  delete from storage.objects o using public.tool_runs r
    where o.bucket_id='tool-outputs' and o.name=any(r.storage_paths)
      -- A run's paths are client supplied. A forged old run must never make
      -- the service-role cleanup delete another user's stored output.
      and public.filey_tool_path_owned(o.name,r.user_id)
      and r.created_at<now()-max_age;
  delete from public.tool_runs where created_at<now()-max_age;
end $$;
revoke execute on function public.prune_tool_runs(interval)
  from public,anon,authenticated;
grant execute on function public.prune_tool_runs(interval) to service_role;

commit;
