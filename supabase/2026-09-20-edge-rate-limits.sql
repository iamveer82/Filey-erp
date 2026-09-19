-- Apply before deploying edge functions that import _shared/rateLimit.ts.
-- Service-only counters: no customer or business records are changed.
begin;
create table if not exists public.edge_rate_limits (
  subject_hash text not null,
  action text not null,
  started_at timestamptz not null,
  used integer not null check (used > 0),
  primary key (subject_hash, action)
);
alter table public.edge_rate_limits enable row level security;
revoke all on public.edge_rate_limits from public,anon,authenticated;

create or replace function public.filey_take_rate_limit(
  p_subject text, p_action text, p_limit integer, p_window_seconds integer
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); v_used integer;
begin
  if p_subject is null or length(p_subject) not between 1 and 512
    or p_action is null or length(p_action) not between 1 and 200
    or p_limit is null or p_limit not between 1 and 10000
    or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'Invalid rate limit request';
  end if;
  -- A single upsert locks this identity/action, so concurrent requests cannot
  -- all pass a read-before-write counter. Non-account identities also work.
  insert into public.edge_rate_limits(subject_hash,action,started_at,used)
    values(encode(sha256(convert_to(p_subject,'UTF8')),'hex'),p_action,v_now,1)
  on conflict(subject_hash,action) do update set
    started_at=case when edge_rate_limits.started_at<=v_now-make_interval(secs=>p_window_seconds)
      then v_now else edge_rate_limits.started_at end,
    used=case when edge_rate_limits.started_at<=v_now-make_interval(secs=>p_window_seconds)
      then 1 else edge_rate_limits.used+1 end
    where edge_rate_limits.used<p_limit
      or edge_rate_limits.started_at<=v_now-make_interval(secs=>p_window_seconds)
  returning used into v_used;
  return v_used is not null;
end $$;
revoke all on function public.filey_take_rate_limit(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.filey_take_rate_limit(text,text,integer,integer) to service_role;
-- ponytail: one row per identity/action; prune inactive counters during routine
-- maintenance if public checkout traffic makes retention material.
notify pgrst,'reload schema';
commit;
