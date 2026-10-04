-- Cloud Filey AI delivery recovery. No prompts, credentials or local records
-- are persisted. A request UUID can launch inference only once; its response
-- and charge commit together. Private results expire after 30 minutes.
begin;
create table if not exists public.ai_completion_results (
  request_id uuid primary key references public.ai_credit_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id text not null,
  run_id uuid not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check (state in ('pending','complete','failed')),
  completion jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  check (octet_length(completion::text) <= 2000000)
);
create index if not exists ai_completion_results_expiry on public.ai_completion_results(expires_at)
  where completion is not null;
alter table public.ai_completion_results enable row level security;
revoke all on public.ai_completion_results from public, anon, authenticated;
grant all on public.ai_completion_results to service_role;

create or replace function public.filey_ai_completion_recovery(p_action text,p_user uuid,p_args jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  j public.ai_completion_results%rowtype;
  a jsonb;
  rid uuid := (p_args->>'request_id')::uuid;
  org text := p_args->>'org_id';
  charge bigint;
begin
  if p_user is null or rid is null then raise exception 'Invalid AI request'; end if;
  -- The lock order always matches the wallet: account, then request/result.
  a := public.filey_ai_wallet('status',p_user);
  if p_action in ('begin','status') and not exists (
    select 1 from public.profiles p join public.org_members m on m.org_id=p.org_id and m.user_id=p.id
    where p.id=p_user and p.org_id=org
  ) then raise exception 'Workspace access unavailable'; end if;
  update public.ai_completion_results set completion=null
    where user_id=p_user and expires_at<=now() and completion is not null;
  select * into j from public.ai_completion_results where request_id=rid for update;
  if found and (j.user_id<>p_user or j.org_id is distinct from org) then
    -- Same response as an unknown identifier, without exposing another owner.
    if p_action='status' then return jsonb_build_object('state','missing'); end if;
    raise exception 'Invalid AI request';
  end if;
  if p_action='begin' and j.request_id is null then
    if coalesce(p_args->>'fingerprint','') !~ '^[0-9a-f]{64}$' or (p_args->>'run_id')::uuid is null then
      raise exception 'Invalid AI request';
    end if;
    perform public.filey_ai_wallet('reserve',p_user,p_args);
    insert into public.ai_completion_results(request_id,user_id,org_id,run_id,fingerprint)
      values(rid,p_user,org,(p_args->>'run_id')::uuid,p_args->>'fingerprint');
    return jsonb_build_object('state','pending','dispatch',true);
  elsif p_action='begin' and (j.run_id is distinct from (p_args->>'run_id')::uuid
    or j.fingerprint is distinct from p_args->>'fingerprint') then
    raise exception 'AI request does not match its original content';
  elsif p_action in ('settle','fail') then
    if j.request_id is null then raise exception 'AI request unavailable'; end if;
    if j.state='pending' then
      if p_action='settle' then
        if jsonb_typeof(p_args->'completion') is distinct from 'object'
          or octet_length((p_args->'completion')::text)>2000000 then raise exception 'Invalid AI response'; end if;
        a := public.filey_ai_wallet('settle',p_user,p_args);
        select charged_micros into charge from public.ai_credit_requests where id=rid and user_id=p_user;
        update public.ai_completion_results set state='complete',completion=p_args->'completion'
          where request_id=rid;
      else
        a := public.filey_ai_wallet('release',p_user,jsonb_build_object('request_id',rid));
        update public.ai_completion_results set state='failed',completion=null where request_id=rid;
      end if;
    end if;
    return a;
  elsif p_action not in ('begin','status') then raise exception 'Unknown AI recovery action'; end if;
  if j.request_id is null then return jsonb_build_object('state','missing'); end if;
  if j.expires_at<=now() then
    return jsonb_build_object('state','failed','message','This reply has expired. Start a new task.');
  end if;
  -- A worker that never finished cannot strand a client indefinitely. Do not
  -- dispatch it again or charge uncertain provider work; let the hold expire.
  if j.state='pending' and j.created_at<now()-interval '3 minutes' then
    perform public.filey_ai_wallet('release',p_user,jsonb_build_object('request_id',rid));
    update public.ai_completion_results set state='failed' where request_id=rid;
    return jsonb_build_object('state','failed','message','Filey AI could not finish this request. No Coins were charged.');
  end if;
  if j.state='complete' then
    select charged_micros into charge from public.ai_credit_requests where id=rid and user_id=p_user;
    return jsonb_build_object('state','complete','completion',j.completion,'account',a,'charged_micros',charge);
  elsif j.state='failed' then
    return jsonb_build_object('state','failed','message','Filey AI could not finish this request. No Coins were charged.');
  end if;
  return jsonb_build_object('state','pending');
end;
$$;
revoke all on function public.filey_ai_completion_recovery(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.filey_ai_completion_recovery(text,uuid,jsonb) to service_role;

create or replace function public.filey_ai_completion_purge()
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.ai_completion_results set completion=null where expires_at<=now() and completion is not null
$$;
revoke all on function public.filey_ai_completion_purge() from public,anon,authenticated;
grant execute on function public.filey_ai_completion_purge() to service_role;
-- Hosted installs with pg_cron purge expired response content each minute.
-- Fresh installs without it still reject expired reads and purge per account.
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('filey-ai-completion-purge','* * * * *','select public.filey_ai_completion_purge()');
  end if;
end $$;
notify pgrst,'reload schema';
commit;
