-- Synthetic accounts only; exercise the real member-avatar RPC and constraint.
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
do $$
declare
  member_id bigint; shape text; colour text; preset text; invalid text;
  profile_before text; tested integer := 0;
begin
  select id into member_id from org_members where org_id=current_org()
    and user_id='00000000-0000-0000-0000-000000000002';
  select avatar into profile_before from profiles where id='00000000-0000-0000-0000-000000000002';
  foreach shape in array array['round','organic','boxy','capsule','nub','cloud','droplet','hexagon','sunburst','triangle'] loop
    foreach colour in array array['sun','mint','coral','sky','lilac','peach','slate','sage','amber','rose'] loop
      preset := '/avatars/blobatar/'||shape||'-'||colour||'.svg';
      perform filey_set_member_avatar(member_id,current_org(),preset);
      if (select avatar_override from filey_team_members() where id=member_id) is distinct from preset then
        raise exception 'Supported shape/colour did not persist: %',preset;
      end if;
      tested := tested+1;
    end loop;
  end loop;
  if tested<>100 then raise exception 'Incomplete shape/colour coverage'; end if;
  foreach preset in array array['sun','mint','coral','sky','lilac','peach','slate','sage','sunburst','triangle'] loop
    perform filey_set_member_avatar(member_id,current_org(),'/avatars/'||preset||'.svg');
    if (select avatar_override from filey_team_members() where id=member_id) is distinct from '/avatars/'||preset||'.svg' then
      raise exception 'Legacy preset no longer supported: %',preset;
    end if;
  end loop;
  foreach invalid in array array[
    'https://tracking.invalid/avatars/blobatar/round-sun.svg',
    '//tracking.invalid/avatars/blobatar/round-sun.svg',
    'data:image/svg+xml,<svg/>',
    '/avatars/blobatar/unknown-sun.svg',
    '/avatars/blobatar/round-red.svg',
    '/avatars/blobatar/round-round.svg',
    '/avatars/blobatar/ROUND-sun.svg',
    '/avatars/blobatar/round-SUN.svg',
    '/avatars/blobatar/round-sun.png',
    '/avatars/blobatar/round-sun.svg?tracking=1',
    '/avatars/blobatar/round-sun.svg#fragment',
    '/avatars/blobatar/round-sun.svg/extra',
    '/avatars/blobatar/../round-sun.svg',
    '/avatars/blobatar/round--sun.svg',
    '/avatars/amber.svg',
    '/avatars/other.svg',
    E'/avatars/blobatar/round-sun.svg\n',
    E'\n/avatars/blobatar/round-sun.svg'
  ] loop
    begin
      perform filey_set_member_avatar(member_id,current_org(),invalid);
      raise exception 'Non-preset URL allowed: %',invalid;
    exception when check_violation then null; end;
  end loop;
  if (select avatar from profiles where id='00000000-0000-0000-0000-000000000002') is distinct from profile_before then
    raise exception 'Workspace override changed the personal profile';
  end if;
  perform filey_set_member_avatar(member_id,current_org(),'/avatars/blobatar/triangle-rose.svg');
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
do $$ declare self_id bigint; other_id bigint; begin
  select id into self_id from org_members where org_id=current_org() and user_id=auth.uid();
  select id into other_id from org_members where org_id=current_org() and user_id<>auth.uid() limit 1;
  perform filey_set_member_avatar(self_id,current_org(),'/avatars/blobatar/triangle-rose.svg');
  if (select avatar_override from filey_team_members() where id=self_id) is distinct from '/avatars/blobatar/triangle-rose.svg' then
    raise exception 'Self shape/colour not saved';
  end if;
  begin perform filey_set_member_avatar(other_id,current_org(),'/avatars/blobatar/round-amber.svg'); raise exception 'Staff changed a colleague'; exception when insufficient_privilege then null; end;
  begin perform filey_set_member_avatar(self_id,'wrong-workspace','/avatars/blobatar/round-amber.svg'); raise exception 'Wrong workspace accepted'; exception when insufficient_privilege then null; end;
  if exists(select 1 from org_members where user_id=auth.uid() and org_id<>current_org() and avatar is not null) then
    raise exception 'Shape/colour leaked into another workspace';
  end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.filey_set_member_avatar(bigint,text,text)','execute')
    or not has_function_privilege('authenticated','public.filey_set_member_avatar(bigint,text,text)','execute') then
    raise exception 'Avatar RPC grants changed';
  end if;
end $$;
select 'PASS: all 100 avatar combinations and ten legacy URLs, arbitrary-path rejection, self/admin scope and unchanged profile/RPC permissions.';
