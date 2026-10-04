-- One locked recurring cycle creates a draft and advances its schedule once.
begin;
-- A boolean integrity gate must see legacy malformed children hidden by RLS.
-- It exposes no child content and checks ownership/module authority itself.
create or replace function public.filey_recurring_items_owned(p_id bigint,p_org text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.invoice_docs;
begin
  if auth.uid() is null or public.current_org() is distinct from p_org or not public.filey_is_workspace_member(p_org) then raise exception 'Invoice unavailable' using errcode='42501'; end if;
  select * into b from public.invoice_docs where id=p_id and org_id=p_org and (user_id=auth.uid() or public.is_org_admin());
  if not found or not public.filey_can_use(case when b.doc_type='purchase' then 'purchase-invoices' else 'invoicing' end) then raise exception 'Invoice unavailable' using errcode='42501'; end if;
  return not exists(select 1 from public.invoice_doc_items where invoice_id=p_id and org_id is distinct from p_org);
end $$;
revoke all on function public.filey_recurring_items_owned(bigint,text) from public,anon;
grant execute on function public.filey_recurring_items_owned(bigint,text) to authenticated;
create or replace function public.filey_generate_recurring_invoice(p_id bigint,p_expected date,p_today date,p_next date,p_actor uuid,p_org text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.invoice_recurrence; b public.invoice_docs; header jsonb; lines jsonb; next_date date; number text; pattern text; kind text; steps int:=0;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor or public.current_org() is distinct from p_org or not public.filey_is_workspace_member(p_org) then
    raise exception 'Your account or workspace changed. Reopen recurring invoices.' using errcode='42501';
  end if;
  select * into r from public.invoice_recurrence where id=p_id for update;
  if not found or r.org_id is distinct from p_org or (r.user_id is distinct from p_actor and not public.is_org_admin()) then
    raise exception 'Recurring invoice unavailable or edit access denied' using errcode='42501';
  end if;
  if not r.active or r.next_run is distinct from p_expected then return false; end if;
  if p_expected is null or p_today is null or p_next is null or p_today<>(now() at time zone 'UTC')::date or p_expected>p_today or p_next<=p_today or r.interval not in ('weekly','monthly','yearly') then
    raise exception 'The recurring invoice schedule is invalid. Review its dates.' using errcode='22023';
  end if;
  select * into b from public.invoice_docs where id=r.base_invoice_id for update;
  if not found or b.org_id is distinct from p_org or (b.user_id is distinct from p_actor and not public.is_org_admin()) then
    raise exception 'Base invoice unavailable or edit access denied' using errcode='42501';
  end if;
  kind:=case when b.doc_type='purchase' then 'purchase_invoice' else 'invoice' end;
  if not public.filey_can_use(case when kind='invoice' then 'invoicing' else 'purchase-invoices' end) then raise exception 'Invoice module access is required' using errcode='42501'; end if;
  next_date:=r.next_run;
  loop
    next_date:=(next_date+case r.interval when 'weekly' then interval '7 days' when 'monthly' then interval '1 month' else interval '1 year' end)::date;
    steps:=steps+1;
    if steps>10000 then raise exception 'The recurring schedule is outside the supported date range'; end if;
    exit when next_date>p_today;
  end loop;
  if next_date<>p_next then raise exception 'The recurring schedule changed. Refresh and retry.' using errcode='40001'; end if;
  select value into pattern from public.app_settings where org_id=p_org and user_id=p_actor and key=case kind when 'invoice' then 'invoice_number_format' else 'purchase_invoice_number_format' end order by id limit 1;
  if pattern is null or pattern !~ '\{[0-9]+\}' then pattern:=case kind when 'invoice' then 'INV' else 'PINV' end||'-{YYYY}-{0001}'; end if;
  number:=public.filey_reserve_document_number(kind,pattern,extract(year from p_today)::int,gen_random_uuid(),p_actor,p_org);
  header:=to_jsonb(b)-array['id','user_id','org_id','created_at','updated_at','sync_revision','shared','shared_with','share_token','due_date','quotation_id','order_id'];
  header:=header||jsonb_build_object('number',number,'status','draft','issue_date',p_today,'advance_applied',0);
  if jsonb_typeof(header->'einvoice')='object' then header:=jsonb_set(header,'{einvoice}',(header->'einvoice')||jsonb_build_object('uuid',gen_random_uuid())); end if;
  select coalesce(jsonb_agg(to_jsonb(i)-array['id','user_id','org_id','created_at','updated_at','sync_revision','shared','shared_with'] order by position,id),'[]'::jsonb) into lines from public.invoice_doc_items i where invoice_id=b.id and org_id=p_org;
  if not public.filey_recurring_items_owned(b.id,p_org) then raise exception 'Review the base invoice item ownership'; end if;
  perform public.filey_save_document('invoice_docs',header,lines);
  update public.invoice_recurrence set next_run=next_date,last_run=p_today where id=r.id;
  if not found then raise exception 'Recurring schedule update denied' using errcode='42501'; end if;
  return true;
end $$;
revoke all on function public.filey_generate_recurring_invoice(bigint,date,date,date,uuid,text) from public,anon;
grant execute on function public.filey_generate_recurring_invoice(bigint,date,date,date,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
