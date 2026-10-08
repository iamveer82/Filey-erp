set role anon;
set test.uid='';
do $$ declare r record; begin
  for r in select * from fixture_public_links loop
    if public.get_shared_doc(r.old_token) is not null then raise exception 'Ambiguous legacy team flag published %',r.kind; end if;
  end loop;
  begin perform public.filey_set_public_document_link('invoice',1,true,'a'); raise exception 'Anonymous publication succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare d jsonb; begin
  d:=public.filey_public_document_fields('{"po_number":"PO-1","supplier_name":"Vendor","supplier_trn":"VAT","order_date":"2026-10-08","expected_date":"2026-10-09","private_future_column":"SECRET"}');
  if d->>'number'<>'PO-1' or d->>'customer_name'<>'Vendor' or d->>'customer_trn'<>'VAT' or d->>'issue_date'<>'2026-10-08' or d->>'due_date'<>'2026-10-09' or d ? 'private_future_column' then raise exception 'Purchase header mapping lost visible values or leaked private data'; end if;
  d:=public.filey_public_document_item('{"description":"PO item","quantity":3,"unit_cost":4,"product_id":999}');
  if d->>'description'<>'PO item' or d->>'qty'<>'3' or d->>'unit_price'<>'4' or d ? 'product_id' then raise exception 'Purchase item amount mapping failed'; end if;
  d:=public.filey_public_document_item('{"product":"Quote item","qty":0,"rate":0,"private_cost":100}');
  if d->>'description'<>'Quote item' or d->>'qty'<>'0' or d->>'unit_price'<>'0' or d ? 'private_cost' then raise exception 'Quote amount mapping lost zero or leaked private data'; end if;
  if public.filey_public_document_fields('{"logo":"VISIBLE-LEGACY-LOGO"}')->>'logo'<>'VISIBLE-LEGACY-LOGO'
    or public.filey_public_document_fields('{"logo":"HIDDEN","show_logo":false}') ? 'logo'
    or public.filey_public_document_fields('{"logo":"HIDDEN","show_logo":null}') ? 'logo' then raise exception 'Saved quote/PO/receipt logo lost or explicitly hidden invoice logo exposed'; end if;
end $$;

set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000001';
do $$ declare r record; t text; token uuid; allowed boolean; begin
  perform public.share_invoice(3,true,'[]');
  select share_token into token from invoice_docs where id=3;
  if public.get_shared_doc(token) is not null then raise exception 'Team-only invoice became public'; end if;
  for r in select * from fixture_public_links loop
    t:=case r.kind when 'invoice' then 'invoice_docs' when 'quotation' then 'quotations' when 'purchase_order' then 'purchase_orders' else 'payment_receipts' end;
    execute format('update %I set shared=false where id=1',t);
    token:=public.filey_set_public_document_link(r.kind,1,true,'a');
    update fixture_public_links set new_token=token where kind=r.kind;
    if token=r.old_token or token is null then raise exception 'Legacy bearer token reused'; end if;
    if public.filey_set_public_document_link(r.kind,1,true,'a')<>token then raise exception 'Copying an enabled link changed its token'; end if;
    execute format('select public_shared and not shared from %I where id=1',t) into allowed;
    if allowed is distinct from true then raise exception 'Public opt-in changed team visibility'; end if;
    -- Generic editor/device writes cannot carry public permission or stale tokens.
    execute format('update %I set public_shared=false,share_token=$1 where id=1',t) using r.old_token;
    if public.get_shared_doc(token) is null then raise exception 'Stale save revoked an explicit public link'; end if;
    execute format('insert into %I(id,user_id,org_id,public_shared,share_token) values(99,auth.uid(),''a'',true,$1)',t) using token;
    execute format('select public_shared from %I where id=99',t) into allowed;
    if allowed is distinct from false then raise exception 'Clone inherited public access'; end if;
  end loop;
end $$;
reset role;

set role anon;
set test.uid='';
do $$ declare r record; d jsonb; key text; begin
  for r in select * from fixture_public_links loop
    d:=public.get_shared_doc(r.new_token);
    if d is null or d->>'doc_type'<>r.kind then raise exception 'Explicit customer link missing'; end if;
    foreach key in array array['id','user_id','org_id','shared','shared_with','share_token','public_shared','private_future_column','stamp','signature','logo','bank_details'] loop
      if d->'doc' ? key then raise exception 'Hidden document data leaked: %.%',r.kind,key; end if;
    end loop;
    if r.kind<>'receipt' then
      if jsonb_array_length(d->'items')<>1 then raise exception 'Cross-workspace/null-org children leaked'; end if;
      if d->'items'->0->>'qty'<>'2' or d->'items'->0->>'unit_price'<>'10'
        or d->'items'->0->'custom'->>'_filey_calc_mode'<>'formula' then raise exception 'Customer line calculations dropped'; end if;
      foreach key in array array['id','user_id','org_id','shared','shared_with','share_token'] loop
        if d->'items'->0 ? key then raise exception 'Line authority leaked'; end if;
      end loop;
    end if;
    if public.get_shared_doc(r.old_token) is not null then raise exception 'Old link revived'; end if;
  end loop;
  d:=public.get_shared_doc((select new_token from fixture_public_links where kind='invoice'));
  if d->'doc'->'einvoice'->'seller'->>'tin'<>'1234567890' or d->'doc'->'einvoice' ? 'private_future_column'
    or d->'doc'->'einvoice'->'seller' ? 'private_future_column' then raise exception 'E-invoice projection leaked private fields or lost identity'; end if;
  if public.get_shared_invoice((select new_token from fixture_public_links where kind='invoice'))<>d-'doc_type' then raise exception 'Legacy invoice output differs'; end if;
  if public.get_shared_invoice((select new_token from fixture_public_links where kind='quotation')) is not null then raise exception 'Legacy invoice RPC returned a quotation'; end if;
end $$;
reset role;

set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ begin
  begin perform public.filey_set_public_document_link('invoice',1,true,'a'); raise exception 'Team recipient published owner document';
  exception when insufficient_privilege then null; end;
end $$;
set test.uid='00000000-0000-0000-0000-000000000005';
do $$ begin
  begin perform public.filey_set_public_document_link('invoice',1,true,'a'); raise exception 'Other workspace admin published document';
  exception when insufficient_privilege then null; end;
  begin perform public.filey_set_public_document_link('invoice',1,true,'b'); raise exception 'Foreign document ID published';
  exception when insufficient_privilege then null; end;
end $$;
set test.uid='00000000-0000-0000-0000-000000000001';
set test.mfa='false';
do $$ begin
  begin perform public.filey_set_public_document_link('invoice',1,true,'a'); raise exception 'MFA bypass'; exception when insufficient_privilege then null; end;
end $$;
set test.mfa='true';
set test.module_allowed='false';
do $$ begin
  begin perform public.filey_set_public_document_link('invoice',1,true,'a'); raise exception 'Module gate bypass'; exception when insufficient_privilege then null; end;
end $$;
set test.module_allowed='true';
do $$ declare r record; t text; token uuid; d jsonb; begin
  for r in select * from fixture_public_links loop
    t:=case r.kind when 'invoice' then 'invoice_docs' when 'quotation' then 'quotations' when 'purchase_order' then 'purchase_orders' else 'payment_receipts' end;
    execute format('update %I set show_stamp=true,show_signature=true,show_logo=true,show_bank=true where id=1',t);
    d:=public.get_shared_doc(r.new_token);
    if d->'doc'->'signature'->>'data'<>'data:image/png;base64,PRIVATE_SIGNATURE_FIXTURE'
      or d->'doc'->'stamp'->>'data'<>'data:image/png;base64,PRIVATE_STAMP_FIXTURE'
      or d->'doc'->>'logo'<>'PRIVATE-LOGO' then raise exception 'Enabled artwork dropped'; end if;
    perform public.filey_set_public_document_link(r.kind,1,false,'a');
    if public.get_shared_doc(r.new_token) is not null then raise exception 'Revoked link stayed live'; end if;
    execute format('update %I set shared=true where id=1',t);
    if public.get_shared_doc(r.new_token) is not null then raise exception 'Team sharing revived revoked link'; end if;
    token:=public.filey_set_public_document_link(r.kind,1,true,'a');
    if token=r.new_token or public.get_shared_doc(r.new_token) is not null then raise exception 'Re-enable revived revoked token'; end if;
    update fixture_public_links set new_token=token where kind=r.kind;
  end loop;
end $$;
-- A current workspace admin can manage the original author's link.
set test.uid='00000000-0000-0000-0000-000000000004';
do $$ begin
  if public.filey_set_public_document_link('invoice',1,true,'a')<>(select new_token from fixture_public_links where kind='invoice') then raise exception 'Admin cannot manage stable link'; end if;
end $$;
reset role;
select 'PASS: public links require explicit owner/admin consent, reject cross-workspace/module/MFA access, rotate revoked tokens, preserve team permissions, hide disabled artwork and unknown private fields, and keep cloned documents private.';
