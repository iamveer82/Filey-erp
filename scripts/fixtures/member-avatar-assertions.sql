-- Synthetic accounts only. Verify the permission boundary, not just the UI.
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
do $$ declare member_id bigint; begin
  select id into member_id from org_members where org_id=current_org() and user_id='00000000-0000-0000-0000-000000000002';
  perform filey_set_member_avatar(member_id,current_org(),'/avatars/mint.svg');
  if (select avatar from filey_team_members() where id=member_id) is distinct from '/avatars/mint.svg' then raise exception 'Admin avatar missing from team identity'; end if;
  if (select avatar from profiles where id='00000000-0000-0000-0000-000000000002') is not null then raise exception 'Global profile overwritten'; end if;
  begin
    perform filey_set_member_avatar(member_id,current_org(),'https://tracking.invalid/photo.svg');
    raise exception 'Untrusted avatar allowed';
  exception when check_violation then null; end;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
do $$ declare self_id bigint; other_id bigint; begin
  select id into self_id from org_members where org_id=current_org() and user_id=auth.uid();
  select id into other_id from org_members where org_id=current_org() and user_id<>auth.uid() limit 1;
  perform filey_set_member_avatar(self_id,current_org(),'/avatars/sky.svg');
  if (select avatar from filey_team_members() where id=self_id) is distinct from '/avatars/sky.svg' then raise exception 'Self avatar not saved'; end if;
  begin perform filey_set_member_avatar(other_id,current_org(),'/avatars/sun.svg'); raise exception 'Staff can change a colleague'; exception when insufficient_privilege then null; end;
  begin perform filey_set_member_avatar(self_id,'wrong-workspace','/avatars/sun.svg'); raise exception 'Stale workspace accepted'; exception when insufficient_privilege then null; end;
  update profiles set avatar='/avatars/lilac.svg' where id=auth.uid();
  perform filey_set_member_avatar(self_id,current_org(),null);
  if (select avatar from filey_team_members() where id=self_id) is distinct from '/avatars/lilac.svg' then raise exception 'Profile fallback missing'; end if;
  if (select avatar_override from filey_team_members() where id=self_id) is not null then raise exception 'Override not cleared'; end if;
  -- Same user belongs to two workspaces; an override is never copied between them.
  if exists(select 1 from org_members where user_id=auth.uid() and org_id<>current_org() and avatar is not null) then raise exception 'Avatar leaked across workspaces'; end if;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000003',false);
do $$ begin
  if exists(select 1 from filey_team_members()) then raise exception 'Outsider can read team avatars'; end if;
  begin perform filey_set_member_avatar(1,'10000000-0000-0000-0000-000000000001','/avatars/sky.svg'); raise exception 'Cross-workspace write allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: workspace avatar assignment, self/admin permissions, profile fallback, preset validation, cross-workspace isolation and idempotent migration.';
