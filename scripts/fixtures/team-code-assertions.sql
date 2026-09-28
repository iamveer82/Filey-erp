-- Disposable database only. No messages, emails or customer records are touched.
reset role;
do $$ begin
 if (select count(*) from team_invite_codes)<>(select count(*) from auth.users) then raise exception 'Account code backfill missing'; end if;
 if exists(select 1 from team_invite_codes where code !~ '^[A-Z0-9]{6}$') then raise exception 'Bad code format'; end if;
end $$;
insert into auth.users values('00000000-0000-0000-0000-000000000005','new@example.invalid',now());
insert into profiles(id,org_id,email,name) values('00000000-0000-0000-0000-000000000005','default','new@example.invalid','New member');
do $$ begin
 if not exists(select 1 from team_invite_codes where user_id='00000000-0000-0000-0000-000000000005') then raise exception 'Signup code missing'; end if;
end $$;
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
do $$ declare a jsonb; b jsonb; begin
 a:=filey_team_connections(); b:=filey_team_connections();
 if a->>'code'<>b->>'code' then raise exception 'Code is unstable'; end if;
 if (select count(*) from team_invite_codes)<>1 then raise exception 'Code directory exposed'; end if;
 begin update team_invite_codes set code='AAAAA'; raise exception 'Client code mutation allowed'; exception when insufficient_privilege then null; end;
 begin perform filey_ensure_team_code('00000000-0000-0000-0000-000000000002'); raise exception 'Private helper exposed'; exception when insufficient_privilege then null; end;
 perform filey_link_team_code('10000000-0000-0000-0000-000000000001');
 perform set_config('test.team_code',a->>'code',false);
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 begin perform filey_link_team_code('10000000-0000-0000-0000-000000000001'); raise exception 'Staff can publish code'; exception when raise_exception then if sqlerrm='Staff can publish code' then raise; end if; end;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000004',false);
do $$ begin
 begin perform filey_request_team_join(current_setting('test.team_code')); raise exception 'Unverified request allowed'; exception when raise_exception then if sqlerrm='Unverified request allowed' then raise; end if; end;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000003',false);
do $$ declare result jsonb; repeat_result jsonb; begin
 result:=filey_request_team_join(lower(current_setting('test.team_code')));
 if result->>'id' is null then raise exception 'Valid request failed: %',result; end if;
 repeat_result:=filey_request_team_join(current_setting('test.team_code'));
 if repeat_result->>'id'<>result->>'id' then raise exception 'Request was duplicated'; end if;
 perform set_config('test.request_id',result->>'id',false);
 if (select count(*) from team_join_requests)<>1 then raise exception 'Requester cannot see own status'; end if;
 if exists(select 1 from filey_workspaces() where id='10000000-0000-0000-0000-000000000001') then raise exception 'Code alone grants access'; end if;
 begin insert into team_join_requests(org_id,applicant_id,inviter_id,status) values('10000000-0000-0000-0000-000000000001',auth.uid(),auth.uid(),'approved'); raise exception 'Self approval allowed'; exception when insufficient_privilege then null; end;
 begin perform filey_review_team_join((result->>'id')::uuid,'10000000-0000-0000-0000-000000000001',true); raise exception 'Outsider approval allowed'; exception when raise_exception then if sqlerrm='Outsider approval allowed' then raise; end if; end;
end $$;
-- A second applicant must not see someone else's join request.
select set_config('test.uid','00000000-0000-0000-0000-000000000005',false);
do $$ declare r jsonb; begin
 if exists(select 1 from team_join_requests) then raise exception 'Other requests exposed'; end if;
 -- Failed requests must commit their rate-limit consumption.
 for n in 1..5 loop r:=filey_request_team_join('!'); end loop;
 r:=filey_request_team_join(current_setting('test.team_code'));
 if r->>'error' not like 'Too many attempts%' then raise exception 'Failed guesses bypass quota'; end if;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
do $$ declare r uuid:=current_setting('test.request_id')::uuid; begin
 if jsonb_array_length(filey_team_connections()->'requests')<>1 then raise exception 'Admin cannot see request'; end if;
 begin perform filey_review_team_join(r,'10000000-0000-0000-0000-000000000002',true); raise exception 'Wrong workspace approved'; exception when raise_exception then if sqlerrm='Wrong workspace approved' then raise; end if; end;
 begin perform filey_review_team_join(r,'10000000-0000-0000-0000-000000000001',true,'owner'); raise exception 'Ownership escalation allowed'; exception when raise_exception then if sqlerrm='Ownership escalation allowed' then raise; end if; end;
 perform filey_review_team_join(r,'10000000-0000-0000-0000-000000000001',true);
 if not exists(select 1 from org_members where user_id='00000000-0000-0000-0000-000000000003' and role='staff' and modules=array['team']) then raise exception 'Least privilege defaults missing'; end if;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000003',false);
do $$ begin
 if current_org()='10000000-0000-0000-0000-000000000001' then raise exception 'Approval switched another account'; end if;
 perform filey_switch_workspace('10000000-0000-0000-0000-000000000001');
 if not filey_can_use('team') or filey_can_use('invoicing') then raise exception 'Module access not enforced'; end if;
 if exists(select 1 from invoice_docs) then raise exception 'Chat-only member can read invoices'; end if;
end $$;
reset role;
-- Rebinding a code cannot retarget existing requests; expiry and role races are safe.
delete from edge_rate_limits where action='team-code';
select set_config('test.uid','00000000-0000-0000-0000-000000000005',false);
set role authenticated;
select filey_request_team_join(current_setting('test.team_code'));
reset role;
update team_join_requests set expires_at=now()-interval '1 minute' where applicant_id='00000000-0000-0000-0000-000000000005';
select set_config('test.request_id',(select id::text from team_join_requests where applicant_id='00000000-0000-0000-0000-000000000005'),false);
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 begin perform filey_review_team_join(current_setting('test.request_id')::uuid,'10000000-0000-0000-0000-000000000001',true); raise exception 'Expired request approved'; exception when raise_exception then if sqlerrm='Expired request approved' then raise; end if; end;
end $$;
reset role;
update team_join_requests set expires_at=now()+interval '1 day' where applicant_id='00000000-0000-0000-0000-000000000005';
insert into org_members(org_id,user_id,role,modules) values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','manager',array['team','crm']);
set role authenticated;
select filey_review_team_join(current_setting('test.request_id')::uuid,'10000000-0000-0000-0000-000000000001',true,'admin',null);
reset role;
do $$ begin
 if not exists(select 1 from org_members where user_id='00000000-0000-0000-0000-000000000005' and role='manager' and modules=array['team','crm']) then raise exception 'Stale request changed existing membership'; end if;
 if (select count(*) from invoice_docs)<>2 then raise exception 'Personal records changed'; end if;
end $$;
select 'PASS: unique stable account codes, signup/backfill, verified requests, no code-based auto-access, rate-limited guesses, admin approval, module enforcement, expiry and existing-member protection.';
-- A new pending request retains its original organization when an account rebinds its code.
insert into auth.users values('00000000-0000-0000-0000-000000000007','rebind@example.invalid',now());
insert into profiles(id,org_id,name) values('00000000-0000-0000-0000-000000000007','default','Rebind');
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000007',false);
select filey_request_team_join(current_setting('test.team_code'));
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
select filey_switch_workspace(filey_create_workspace('Second workspace'));
select filey_link_team_code(current_org()::uuid);
reset role;
do $$ begin
 if not exists(select 1 from team_join_requests where applicant_id='00000000-0000-0000-0000-000000000007' and org_id='10000000-0000-0000-0000-000000000001') then raise exception 'Code rebind retargeted request'; end if;
end $$;
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000007',false);
select filey_cancel_team_join((filey_team_connections()->'requests'->0->>'id')::uuid);
do $$ begin
 if (filey_team_connections()->'requests'->0->>'status')<>'canceled' then raise exception 'Applicant cannot cancel request'; end if;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
select filey_switch_workspace('10000000-0000-0000-0000-000000000001');
select filey_link_team_code('10000000-0000-0000-0000-000000000001');
reset role;
select 'PASS: rebinding preserves the destination of existing requests; applicants can cancel their requests.';
