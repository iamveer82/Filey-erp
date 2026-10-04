-- Service-only atomic inquiry, voucher, coupon and owner notification setup.
-- Existing inquiries/coupons are retained. Public callers use the bounded,
-- rate-limited lead-contact endpoint; they cannot call this RPC directly.
begin;
create table if not exists public.lead_setup_requests (
  request_id uuid primary key,
  payload jsonb not null,
  lead_id bigint not null references public.lead_requests(id),
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.lead_setup_requests enable row level security;
revoke all on public.lead_setup_requests from public,anon,authenticated;
grant all on public.lead_setup_requests to service_role;

create or replace function public.filey_record_lead(
  p_request uuid,p_name text,p_phone text,p_email text,p_message text,
  p_source text,p_ip text,p_plan text,p_code text,p_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_payload jsonb; v_saved public.lead_setup_requests; v_id bigint; v_result jsonb;
  v_owner public.profiles; v_emailed boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service access required' using errcode='42501';
  end if;
  if p_request is null or p_name is null or btrim(p_name)='' or length(p_name)>120
    or p_phone is null or length(p_phone)>40 or length(regexp_replace(p_phone,'[^0-9]','','g'))<6
    or coalesce(length(p_email),0)>200 or coalesce(length(p_message),0)>1000
    or p_source is null or p_source not in ('app','website')
    or p_ip is null or length(p_ip)>128
    or p_plan is null or p_plan not in ('freedom','enterprise') then
    raise exception 'Invalid inquiry' using errcode='22023';
  end if;
  if (p_plan='enterprise' and (p_code is not null or p_expires_at is not null))
    or (p_plan='freedom' and (p_code is null
      or p_code!~'^FL-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$'
      or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '31 days')) then
    raise exception 'Invalid inquiry follow-up' using errcode='22023';
  end if;
  -- Provider-generated coupon/expiry and changing network address are not part
  -- of the user's immutable form. A retry gets the originally stored values.
  v_payload:=jsonb_build_object('name',p_name,'phone',p_phone,'email',coalesce(p_email,''),
    'message',coalesce(p_message,''),'source',p_source,'plan',p_plan);
  perform pg_advisory_xact_lock(hashtextextended('filey:lead:'||p_request::text,0));
  select * into v_saved from public.lead_setup_requests where request_id=p_request;
  if found then
    if v_saved.payload is distinct from v_payload then
      raise exception 'Inquiry request was already used differently' using errcode='22023';
    end if;
    select emailed into strict v_emailed from public.lead_requests where id=v_saved.lead_id;
    return v_saved.result||jsonb_build_object('emailed',v_emailed);
  end if;
  insert into public.lead_requests(name,phone,email,message,plan,source,ip)
    values(p_name,p_phone,nullif(p_email,''),
      case when p_plan='enterprise' then '[Enterprise inquiry] '||coalesce(p_message,'') else nullif(p_message,'') end,
      p_plan,p_source,p_ip) returning id into v_id;
  if p_plan='freedom' then
    insert into public.vouchers(code,max_uses,expires_at) values(p_code,1,p_expires_at);
    insert into public.lead_coupons(lead_id,name,phone,email,message,source,code)
      values(v_id,p_name,p_phone,nullif(p_email,''),nullif(p_message,''),p_source,p_code);
  end if;
  -- A customer's signup order is never authority to receive private leads or
  -- license codes. Only the configured platform owner gets the notification.
  select p.* into v_owner from public.profiles p join public.platform_config c
    on c.key='owner_uid' and c.value=p.id::text;
  if found then
    insert into public.notifications(org_id,user_id,actor,kind,body,link)
      values(v_owner.org_id,v_owner.id,'Website','lead',
        case when p_plan='enterprise' then p_name||' requested Filey Enterprise. Review their requirements and contact details.'
          else p_name||' requested Filey Freedom. Coupon '||p_code||' (expires '||to_char(p_expires_at at time zone 'UTC','YYYY-MM-DD')||').' end,
        '/settings?section=billing');
  end if;
  v_result:=jsonb_build_object('id',v_id,'code',p_code,'expires_at',p_expires_at,'emailed',false);
  insert into public.lead_setup_requests(request_id,payload,lead_id,result) values(p_request,v_payload,v_id,v_result);
  return v_result;
end $$;
revoke all on function public.filey_record_lead(uuid,text,text,text,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.filey_record_lead(uuid,text,text,text,text,text,text,text,text,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
