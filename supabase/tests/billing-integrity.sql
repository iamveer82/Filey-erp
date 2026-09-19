-- Run after 2026-09-19-billing-integrity.sql. All synthetic data rolls back.
begin;
do $$
declare
  v_id text := 'filey-check-' || gen_random_uuid();
  v_result text;
  v_status text;
begin
  perform public.filey_apply_dodo_subscription(v_id, 'qa@filey.invalid', null, null, null,
    'active', now() + interval '1 month', now() - interval '2 minutes');
  perform public.filey_apply_dodo_subscription(v_id, 'qa@filey.invalid', null, null, null,
    'canceled', now() + interval '1 month', now());
  select public.filey_apply_dodo_subscription(v_id, 'qa@filey.invalid', null, null, null,
    'active', now() + interval '1 month', now() - interval '1 minute') into v_result;
  if v_result <> 'ignored older event' then raise exception 'Old event was accepted'; end if;
  select plan_status into v_status from public.pending_entitlements where dodo_subscription_id = v_id;
  if v_status <> 'canceled' then raise exception 'Canceled purchase could be claimed'; end if;
  if has_function_privilege('authenticated',
    'public.filey_apply_dodo_subscription(text,text,text,text,uuid,text,timestamptz,timestamptz)', 'execute')
  then raise exception 'Client can write billing state'; end if;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  if (public.filey_claim_entitlements()->>'claimed')::boolean then
    raise exception 'Unverified identity claimed a purchase';
  end if;
end $$;
rollback;
