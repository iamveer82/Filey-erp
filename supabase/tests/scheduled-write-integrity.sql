-- Synthetic fixture only; invoked by test-channel-agent-local.mjs.
do $$ declare
  owner_id uuid := '10000000-0000-0000-0000-000000000001';
  license_id uuid; result jsonb; failed boolean; sid bigint;
begin
  if has_function_privilege('authenticated','filey_claim_license_device(uuid,text,text)','execute')
    or has_function_privilege('anon','filey_agent_lowstock_po(uuid,text)','execute') then
    raise exception 'Scheduled RPC exposed to clients';
  end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  failed:=false;
  begin perform filey_claim_license_device(owner_id,'device','test'); exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Non-service license claim allowed'; end if;
  failed:=false;
  begin perform filey_agent_lowstock_po(owner_id,'ORG'); exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Non-service scheduled writes allowed'; end if;
  perform set_config('request.jwt.claim.role','service_role',true);
  insert into licenses(user_id,product,status) values(owner_id,'filey-desktop','active') returning id into license_id;
  result:=filey_claim_license_device(owner_id,'first','test');
  perform filey_claim_license_device(owner_id,'first','test');
  perform filey_claim_license_device(owner_id,'second','test');
  failed:=false;
  begin perform filey_claim_license_device(owner_id,'third','test'); exception when sqlstate 'PT409' then failed:=true; end;
  if not failed or (select count(*) from license_devices where deactivated_at is null)<>2 then raise exception 'Device limit broken'; end if;
  update license_devices set deactivated_at=now() where fingerprint='first';
  perform filey_claim_license_device(owner_id,'third','test');
  failed:=false;
  begin perform filey_claim_license_device(owner_id,'first','test'); exception when sqlstate 'PT409' then failed:=true; end;
  if not failed then raise exception 'Reactivation bypassed slots'; end if;
  failed:=false;
  begin perform filey_claim_license_device('10000000-0000-0000-0000-000000000002','other','test'); exception when sqlstate 'PT404' then failed:=true; end;
  if not failed then raise exception 'Another user claimed license'; end if;
  delete from license_devices;

  failed:=false;
  begin perform filey_agent_lowstock_po(owner_id,'OTHER'); exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Cross-workspace stock write allowed'; end if;
  update org_members set role='staff' where user_id=owner_id;
  failed:=false;
  begin perform filey_agent_lowstock_po(owner_id,'ORG'); exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Staff bypassed draft authority'; end if;
  update org_members set role='owner' where user_id=owner_id;
  insert into suppliers(org_id,name) values('ORG','Scheduled supplier') returning id into sid;
  insert into products(org_id,name,quantity,reorder_level,cost_price,supplier_id) values
    ('ORG','First',0,1,0.01,sid),('ORG','FAIL',0,1,10,sid);
  failed:=false;
  begin perform filey_agent_lowstock_po(owner_id,'ORG'); exception when check_violation then failed:=true; end;
  if not failed or exists(select 1 from purchase_orders where notes='Auto-created from low stock (agent)') then
    raise exception 'Partial scheduled header survived rejected line';
  end if;
  update products set name='Second' where name='FAIL';
  result:=filey_agent_lowstock_po(owner_id,'ORG');
  if jsonb_array_length(result)<>1 then raise exception 'Retry did not create draft'; end if;
  if (select total from purchase_orders where id=(result->0->>'id')::bigint)<>20.02 then raise exception 'Scheduled total incorrect'; end if;
  update purchase_orders set status='sent' where id=(result->0->>'id')::bigint;
  if filey_agent_lowstock_po(owner_id,'ORG')<>'[]'::jsonb then raise exception 'Submitted same-day PO was duplicated'; end if;
  delete from purchase_order_items where po_id=(result->0->>'id')::bigint;
  delete from purchase_orders where id=(result->0->>'id')::bigint;
  raise notice 'PASS: license slot ownership/idempotency/reactivation; scheduled scope, atomic lines/rollback, retry and submitted-day dedup.';
end $$;
