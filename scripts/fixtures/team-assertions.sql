set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
do $$ declare i jsonb; retry jsonb; begin
 i:=filey_prepare_invitation(' STAFF@EXAMPLE.INVALID ','staff');
 retry:=filey_prepare_invitation('staff@example.invalid','admin');
 if i->>'id'<>retry->>'id' or i->>'email_send_id'<>retry->>'email_send_id' or retry->>'role'<>'staff' then raise exception 'Duplicate request changes invitation or privileges'; end if;
 if i->>'org_id'<>'10000000-0000-0000-0000-000000000001' then raise exception 'Workspace missing'; end if;
 begin perform filey_prepare_invitation(null,'staff',null,(i->>'id')::uuid,true); raise exception 'Resend cooldown missing'; exception when raise_exception then if sqlerrm='Resend cooldown missing' then raise; end if; end;
 begin insert into invitations(org_id,email) values(current_org(),'direct@example.invalid'); raise exception 'Direct invitation write allowed'; exception when insufficient_privilege then null; end;
 insert into invoice_docs(id,name,shared) values(1,'Shared invoice',true),(2,'Private invoice',false);
end $$;
-- The invitee retains their own workspace and joins the second one.
select set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
do $$ declare i uuid; begin
 i:=(filey_my_invitations()->0->>'id')::uuid;
 if i is null then raise exception 'Invitee cannot discover invitation'; end if;
 perform accept_invitation(i);
 if current_org()<>'10000000-0000-0000-0000-000000000001' then raise exception 'Join did not switch workspace'; end if;
 if (select count(*) from filey_workspaces())<>2 then raise exception 'Previous workspace lost'; end if;
 if (select count(*) from invoice_docs)<>1 then raise exception 'Private invoice leaked'; end if;
 update invoice_docs set name='changed' where id=1;
 if found then raise exception 'Shared recipient could edit invoice'; end if;
 insert into org_messages(body) values('Hello @owner');
 begin perform filey_prepare_invitation('stranger@example.invalid'); raise exception 'Staff can invite'; exception when raise_exception then if sqlerrm='Staff can invite' then raise; end if; end;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
do $$ declare page jsonb; root bigint; begin
 page:=filey_message_page('general');
 if jsonb_array_length(page->'rows')<>1 then raise exception 'Team message invisible'; end if;
 root:=(page->'rows'->0->>'id')::bigint;
 insert into org_messages(body,parent_id) values('Welcome',root);
 if not exists(select 1 from filey_unread_channels() where channel='general' and unread=1) then raise exception 'Unread count wrong'; end if;
 perform filey_mark_channel_read('general',root);
 if exists(select 1 from filey_unread_channels()) then raise exception 'Read marker not applied'; end if;
 if not exists(select 1 from notifications where user_id=auth.uid() and link='/team?channel=general&message='||root) then raise exception 'Mention has wrong destination'; end if;
 -- A busy channel must neither hide a different channel nor orphan replies.
 insert into org_messages(body,channel) select 'Message '||n,'sales' from generate_series(1,65) n;
 if jsonb_array_length(filey_message_page('general')->'rows')<>2 then raise exception 'Cross-channel pagination broke'; end if;
 page:=filey_message_page('sales');
 if jsonb_array_length(page->'rows')<>30 or page->>'next' is null then raise exception 'First page wrong'; end if;
 page:=filey_message_page('sales',(page->>'next')::bigint);
 if jsonb_array_length(page->'rows')<>30 then raise exception 'Second page wrong'; end if;
 begin insert into org_messages(body,parent_id,channel) values('wrong',root,'sales'); raise exception 'Cross-channel reply allowed'; exception when raise_exception then if sqlerrm='Cross-channel reply allowed' then raise; end if; end;
end $$;
-- Mutable display email cannot impersonate a recipient.
select set_config('test.uid','00000000-0000-0000-0000-000000000003',false);
update profiles set email='owner@example.invalid' where id=auth.uid();
do $$ begin
 if my_email()<>'stranger@example.invalid' then raise exception 'Display email trusted'; end if;
 if exists(select 1 from filey_unread_channels()) or jsonb_array_length(filey_my_invitations())<>0 then raise exception 'Outsider saw workspace state'; end if;
 begin perform filey_switch_workspace('10000000-0000-0000-0000-000000000001'); raise exception 'Outsider switched workspace'; exception when raise_exception then if sqlerrm='Outsider switched workspace' then raise; end if; end;
end $$;
reset role;
-- Expiry and revocation are checked by acceptance, not just hidden by the UI.
insert into invitations(id,org_id,email,expires_at) values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','stranger@example.invalid',now()-interval '1 minute');
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000003',false);
do $$ begin
 begin perform accept_invitation('20000000-0000-0000-0000-000000000001'); raise exception 'Expired invitation accepted'; exception when raise_exception then if sqlerrm='Expired invitation accepted' then raise; end if; end;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000004',false);
do $$ begin if my_email() is not null then raise exception 'Unverified email trusted'; end if; end $$;
reset role;
select 'PASS: owner invites staff, staff joins, messages/replies/mentions/unreads, shared invoice access, isolated workspaces, expiry, verified identities and idempotent email retries.';
