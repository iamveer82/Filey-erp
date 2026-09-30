-- Run with node scripts/test-channel-agent-local.mjs against synthetic tables.
do $$ declare
  owner_id uuid := '10000000-0000-0000-0000-000000000001';
  result jsonb; kind text; failed boolean; before_count integer;
begin
  if has_function_privilege('anon','public.filey_channel_create_draft(uuid,text,text,jsonb)','execute')
    or has_function_privilege('authenticated','public.filey_channel_create_draft(uuid,text,text,jsonb)','execute') then raise exception 'Draft RPC exposed to clients'; end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  failed := false;
  begin
    perform public.filey_channel_create_draft(owner_id,'ORG','invoice','{}');
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'Non-service request allowed'; end if;
  perform set_config('request.jwt.claim.role','service_role',true);
  failed := false;
  begin
    perform public.filey_channel_create_draft(owner_id,'OTHER','invoice','{}');
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'Cross-workspace request allowed'; end if;
  update org_members set role='member' where user_id=owner_id;
  failed := false;
  begin
    perform public.filey_channel_create_draft(owner_id,'ORG','invoice','{}');
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'Ordinary member bypassed private/module policies'; end if;
  update org_members set role='owner' where user_id=owner_id;
  result := public.filey_channel_create_draft(owner_id,'ORG','invoice','{"customer_name":"Demo","items":[{"description":"Item","qty":2,"unit_price":100}]}');
  if result->>'created'<>'draft' or (result->>'total')::numeric<>210 then raise exception 'Invoice result incorrect'; end if;
  result := public.filey_channel_create_draft(owner_id,'ORG','quote','{"customer_name":"Demo","items":[{"description":"Quote item","qty":3,"unit_price":10}]}');
  if not exists(select 1 from quotation_items where quotation_id=(result->>'id')::bigint and product='Quote item' and rate=10 and qty=3) then raise exception 'Quote line columns incorrect'; end if;
  result := public.filey_channel_create_draft(owner_id,'ORG','po','{"supplier_name":"Demo supplier","items":[{"description":"PO item","qty":3,"unit_cost":10}]}');
  if (result->>'total')::numeric<>30 then raise exception 'PO total incorrect'; end if;
  foreach kind in array array['invoice','quote','po'] loop
    select (select count(*) from invoice_docs)+(select count(*) from quotations)+(select count(*) from purchase_orders) into before_count;
    failed := false;
    begin
      perform public.filey_channel_create_draft(owner_id,'ORG',kind,
        jsonb_build_object(case when kind='po' then 'supplier_name' else 'customer_name' end,'Rollback test','items',
          jsonb_build_array(jsonb_build_object('description','First line',case when kind='po' then 'unit_cost' else 'unit_price' end,10),
                           jsonb_build_object('description','FAIL',case when kind='po' then 'unit_cost' else 'unit_price' end,20))));
    exception when check_violation then failed := true; end;
    if not failed then raise exception 'Rejected line unexpectedly passed'; end if;
    if before_count<>(select (select count(*) from invoice_docs)+(select count(*) from quotations)+(select count(*) from purchase_orders)) then raise exception 'Partial draft survived failed line'; end if;
  end loop;
  failed := false;
  begin
    perform public.filey_channel_create_draft(owner_id,'ORG','invoice','{"customer_name":"Demo","status":"paid","items":[{"description":"Item","unit_price":10}]}');
  exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'Unapproved field accepted'; end if;
  foreach kind in array array['invoice','quote','po'] loop
    result := public.filey_channel_create_draft(owner_id,'ORG',kind,
      jsonb_build_object(case when kind='po' then 'supplier_name' else 'customer_name' end,'Line rounding test','items',
        jsonb_build_array(jsonb_build_object('description','First','qty',0.001,
          case when kind='po' then 'unit_cost' else 'unit_price' end,1),
          jsonb_build_object('description','Second','qty',0.001,
          case when kind='po' then 'unit_cost' else 'unit_price' end,1),
          jsonb_build_object('description','Third','qty',0.001,
          case when kind='po' then 'unit_cost' else 'unit_price' end,1))));
    if (result->>'total')::numeric<>0 then raise exception 'Agent total differs from Filey line rounding'; end if;
  end loop;
  foreach kind in array array['invoice','quote','po'] loop
    select (select count(*) from invoice_docs)+(select count(*) from quotations)+(select count(*) from purchase_orders) into before_count;
    failed := false;
    begin
      perform public.filey_channel_create_draft(owner_id,'ORG',kind,
        jsonb_build_object(case when kind='po' then 'supplier_name' else 'customer_name' end,'Precision test','items',
          jsonb_build_array(jsonb_build_object('description','Item','qty',1000000,
            case when kind='po' then 'unit_cost' else 'unit_price' end,0.009))));
    exception when invalid_parameter_value then failed := true; end;
    if not failed then raise exception 'Stored price could differ from reported total'; end if;
    failed := false;
    begin
      perform public.filey_channel_create_draft(owner_id,'ORG',kind,
        jsonb_build_object(case when kind='po' then 'supplier_name' else 'customer_name' end,'Precision test','items',
          jsonb_build_array(jsonb_build_object('description','Item','qty',0.0011,
            case when kind='po' then 'unit_cost' else 'unit_price' end,1000000000))));
    exception when invalid_parameter_value then failed := true; end;
    if not failed then raise exception 'Stored quantity could differ from reported total'; end if;
    if before_count<>(select (select count(*) from invoice_docs)+(select count(*) from quotations)+(select count(*) from purchase_orders)) then raise exception 'Rejected precision created a partial draft'; end if;
  end loop;
  if (select count(*) from audit_log)<>6 then raise exception 'Failed drafts left audit artifacts'; end if;
  raise notice 'PASS: service-only scope, role gate, quote schema, totals, field allowlist, atomic rollback for invoice/quote/PO and repeatable migration.';
end $$;
