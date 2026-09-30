-- Apply before deploying dodo/stripe and agent-jobs. No existing rows change.
begin;

create or replace function public.filey_claim_license_device(
  p_user uuid, p_fingerprint text, p_device_name text default ''
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_license public.licenses; v_device public.license_devices;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'License service access required' using errcode='42501';
  end if;
  if p_user is null or p_fingerprint is null or length(p_fingerprint) not between 1 and 256
    or length(coalesce(p_device_name,''))>200 then
    raise exception 'Invalid device' using errcode='22023';
  end if;
  select * into v_license from public.licenses
    where user_id=p_user and status='active' order by created_at,id limit 1 for update;
  if not found then raise exception 'No active license' using errcode='PT404'; end if;
  select * into v_device from public.license_devices
    where license_id=v_license.id and fingerprint=p_fingerprint;
  if v_device.id is not null and v_device.deactivated_at is null then
    return jsonb_build_object('license_id',v_license.id,'product',v_license.product);
  end if;
  if (select count(*) from public.license_devices where license_id=v_license.id and deactivated_at is null)>=2 then
    raise exception 'Device slots full' using errcode='PT409';
  end if;
  insert into public.license_devices(license_id,fingerprint,device_name)
    values(v_license.id,p_fingerprint,nullif(p_device_name,''))
    on conflict(license_id,fingerprint) do update
      set deactivated_at=null,activated_at=now(),device_name=excluded.device_name;
  return jsonb_build_object('license_id',v_license.id,'product',v_license.product);
end $$;
revoke all on function public.filey_claim_license_device(uuid,text,text) from public,anon,authenticated;
grant execute on function public.filey_claim_license_device(uuid,text,text) to service_role;

create or replace function public.filey_agent_lowstock_po(p_owner uuid,p_org text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_group record; v_product record; v_supplier public.suppliers;
  v_id bigint; v_number text; v_qty numeric; v_total numeric; v_position integer;
  v_created jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'Scheduled agent access required' using errcode='42501';
  end if;
  perform 1 from public.profiles p join public.org_members m on m.user_id=p.id and m.org_id=p.org_id
    where p.id=p_owner and p.org_id=p_org and m.role in ('owner','admin') for share of p,m;
  if not found then raise exception 'Workspace access denied' using errcode='42501'; end if;
  -- Concurrent schedules share one transaction lock. Header, lines and audit
  -- either all commit or all roll back; no empty draft can mask a retry.
  perform pg_advisory_xact_lock(hashtextextended('filey-lowstock:'||p_org||':'||current_date,0));
  for v_group in select distinct supplier_id from public.products
    where org_id=p_org and reorder_level>0 and quantity<=reorder_level loop
    if exists(select 1 from public.purchase_orders po where po.org_id=p_org
      and po.supplier_id is not distinct from v_group.supplier_id and po.order_date=current_date
      and po.notes='Auto-created from low stock (agent)'
      and exists(select 1 from public.purchase_order_items i where i.po_id=po.id and i.org_id=p_org)) then
      continue;
    end if;
    v_supplier := null;
    if v_group.supplier_id is not null then
      select * into v_supplier from public.suppliers where id=v_group.supplier_id and org_id=p_org for share;
      if not found then raise exception 'Low-stock supplier is outside this workspace' using errcode='42501'; end if;
    end if;
    v_number := 'PO-'||extract(year from current_date)::text||'-A'||left(replace(gen_random_uuid()::text,'-',''),12);
    insert into public.purchase_orders(user_id,org_id,po_number,status,supplier_id,supplier_name,
      supplier_address,supplier_email,supplier_phone,supplier_trn,currency,total,order_date,notes)
    values(p_owner,p_org,v_number,'draft',v_group.supplier_id,coalesce(v_supplier.name,''),
      coalesce(v_supplier.address,''),coalesce(v_supplier.email,''),coalesce(v_supplier.phone,''),
      coalesce(v_supplier.tax_id,''),'AED',0,current_date,'Auto-created from low stock (agent)') returning id into v_id;
    v_total := 0; v_position := 0;
    for v_product in select * from public.products where org_id=p_org
      and supplier_id is not distinct from v_group.supplier_id and reorder_level>0 and quantity<=reorder_level
      order by id for share loop
      v_qty := greatest(1,2*v_product.reorder_level-v_product.quantity);
      if v_product.cost_price<0 then raise exception 'Invalid low-stock product cost' using errcode='22023'; end if;
      insert into public.purchase_order_items(user_id,org_id,po_id,product_id,description,quantity,unit_cost,unit,position)
        values(p_owner,p_org,v_id,v_product.id,v_product.name,v_qty,v_product.cost_price,v_product.unit,v_position);
      v_total := v_total+round(v_qty*v_product.cost_price,2); v_position := v_position+1;
    end loop;
    if v_position=0 then raise exception 'Stock changed during draft creation; retry' using errcode='40001'; end if;
    update public.purchase_orders set total=v_total where id=v_id;
    insert into public.audit_log(user_id,actor,action,entity,details)
      values(p_owner,'agent','agent.lowstock_po','purchase_orders:'||v_id,v_number||' saved as a draft');
    v_created := v_created||jsonb_build_array(jsonb_build_object('id',v_id,'number',v_number,'supplier_name',coalesce(v_supplier.name,'')));
  end loop;
  return v_created;
end $$;
revoke all on function public.filey_agent_lowstock_po(uuid,text) from public,anon,authenticated;
grant execute on function public.filey_agent_lowstock_po(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
