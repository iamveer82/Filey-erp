insert into auth.sessions values('legacy-session','00000000-0000-0000-0000-000000000001',now()-interval '1 day'),
  ('fresh-session','00000000-0000-0000-0000-000000000001',now()+interval '1 second');
grant select,delete on public.org_devices to authenticated;
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000001';
do $$ declare i integer; r jsonb; begin
  for i in 1..20 loop
    r:=public.register_device('device-'||i,'Test device');
    assert (r->>'ok')::boolean, 'The first 20 devices must register';
  end loop;
  r:=public.register_device('device-21');
  assert r->>'reason'='limit' and (r->>'limit')::int=20, 'Device 21 must be refused';
  r:=public.register_device('device-1','Renamed device');
  assert (r->>'existing')::boolean, 'Existing devices must still sign in at the limit';
  assert (select count(*) from public.org_devices)=20, 'Re-registering must not consume a slot';
  perform public.filey_logout_device((select id from public.org_devices where fingerprint='device-20'));
  assert public.filey_device_logged_out('device-20'), 'The device must know it was logged out';
  assert public.register_device('device-20')->>'reason'='logged_out', 'The old session cannot reclaim the slot';
  perform set_config('test.session','session-new',true);
  assert (public.register_device('device-20')->>'ok')::boolean, 'A fresh sign-in can register again';
  perform public.filey_logout_device((select id from public.org_devices where fingerprint='device-20'));
end $$;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select count(*) from public.org_devices)=0, 'Another workspace must not see devices';
  assert (public.register_device('device-1')->>'ok')::boolean, 'Workspaces have independent limits';
end $$;
reset role;
update public.org_devices set session_id=null where fingerprint='device-20' and user_id='00000000-0000-0000-0000-000000000001';
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000001';
set test.session='legacy-session';
do $$ begin
  assert public.filey_device_logged_out('device-20'), 'Legacy registrations must also log out';
  assert public.register_device('device-20')->>'reason'='logged_out', 'Refreshing an old token cannot undo logout';
  perform set_config('test.session','fresh-session',true);
  assert (public.register_device('device-20')->>'ok')::boolean, 'A new authentication can restore a legacy device';
  perform public.filey_logout_device((select id from public.org_devices where fingerprint='device-20'));
end $$;
reset role;
do $$ begin
  assert not has_function_privilege('anon','public.register_device(text,text)','execute'), 'Anonymous registration must be denied';
end $$;
select 'PASS: 20 cloud devices, existing sign-ins, slot release, workspace isolation and anonymous denial.';
