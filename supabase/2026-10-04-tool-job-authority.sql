-- Queued tool specifications/results must not be editable while a trusted
-- worker runs them. Preserve owner reads/pending cancellation and current
-- engines; successful output/status writes belong to service role only.
begin;
create or replace function public.filey_admit_tool_job()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or coalesce(auth.role(),'')='service_role' then return new; end if;
  if new.user_id is distinct from auth.uid() or new.status is distinct from 'pending'
    or new.error is not null or cardinality(new.output_paths) is distinct from 0 then
    raise exception 'New tool jobs must be pending without results' using errcode='42501';
  end if;
  if not ((new.engine='edge' and new.tool='rotate') or (new.engine='worker'
    and new.tool in ('office2pdf','pdf2docx','ocr','pdfa','compress')))
    or jsonb_typeof(new.params) is distinct from 'object' or octet_length(new.params::text)>65536
    or length(new.file_name)>240 or new.file_name ~ '[[:cntrl:]]'
    or new.size_bytes not between 0 and 52428800 then
    raise exception 'Invalid tool job specification' using errcode='22023';
  end if;
  if not public.filey_take_rate_limit(auth.uid()::text,'tool_job_create',15,3600) then
    raise exception 'Tool job limit reached. Try again later.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.filey_admit_tool_job() from public,anon,authenticated;
do $$ declare column_name text; begin
  if to_regclass('public.tool_jobs') is null then return; end if;
  drop trigger if exists filey_admit_tool_job on public.tool_jobs;
  create trigger filey_admit_tool_job before insert on public.tool_jobs for each row execute function public.filey_admit_tool_job();
  revoke update on public.tool_jobs from public,anon,authenticated;
  -- A table-level revoke does not revoke any old column-level grant.
  for column_name in select attname from pg_attribute where attrelid='public.tool_jobs'::regclass
    and attnum>0 and not attisdropped loop
    execute format('revoke update (%I) on public.tool_jobs from public,anon,authenticated',column_name);
  end loop;
  drop policy if exists filey_cancel_pending on public.tool_jobs;
  create policy filey_cancel_pending on public.tool_jobs as restrictive for delete to authenticated using(status='pending');
end $$;
notify pgrst,'reload schema';
commit;
