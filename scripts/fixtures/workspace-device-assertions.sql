set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000001';
select register_device('owner-browser');
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ begin
  assert not exists(select 1 from org_devices),'Staff cannot see other member raw fingerprint/session';
  assert register_device('owner-browser')->>'reason'='device_in_use','Even a known fingerprint cannot be reassigned';
  assert (register_device('staff-browser')->>'ok')::boolean,'Staff own device registration preserved';
  assert (register_device('staff-browser')->>'existing')::boolean,'Own registration renews without another slot';
  assert (select count(*) from org_devices)=1,'Staff reads only own raw device';
end $$;
set test.uid='00000000-0000-0000-0000-000000000003';
do $$ declare denied boolean:=false; begin
  assert not exists(select 1 from org_devices),'Former member registry reads denied';
  assert register_device('former-member-browser')->>'reason'='workspace_access','Former member slot occupation denied';
  begin perform filey_logout_device('70000000-0000-4000-8000-000000000001');exception when insufficient_privilege then denied:=true;end;
  assert denied,'Former member logout denied';
  assert not filey_device_logged_out('owner-browser'),'Former member cannot inspect logout status';
end $$;
set test.uid='00000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from org_devices)=2,'Owner administers complete registry';
  perform filey_logout_device((select id from org_devices where fingerprint='staff-browser'));
end $$;
set test.uid='00000000-0000-0000-0000-000000000002';
do $$ begin
  assert filey_device_logged_out('staff-browser'),'Own revoked device detects logout';
  assert register_device('staff-browser')->>'reason'='logged_out','Old session cannot evade revocation';
  perform set_config('test.session','fresh-staff-session',true);
  assert (register_device('staff-browser')->>'ok')::boolean,'Fresh own sign-in can renew revoked slot';
  assert register_device(repeat('x',257))->>'reason'='invalid_device','Device identity is bounded';
end $$;
reset role;
select 'PASS: current membership, own/admin raw registry, no known-fingerprint takeover, logout and fresh-session preservation.';
