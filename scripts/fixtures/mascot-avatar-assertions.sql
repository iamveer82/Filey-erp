set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
do $$ declare member_id bigint; mascot text; invalid text; begin
  select id into member_id from org_members where org_id=current_org() and user_id='00000000-0000-0000-0000-000000000002';
  foreach mascot in array array['bear','bunny','cat','deer','dino','fox','frog','hamster','hedgehog','koala','mouse','otter','owl','panda','penguin','pug','raccoon','redpanda','sheep','sloth','tiger','afro','astronaut','bald','ballerina','beard','builder','cap','chef','glasses','grandpa','granny','hijabi','kamran','nurse','pirate','scientist','sikh','skater','wizard','clockwork','crt','cube','drone','gearbot','knight','lantern','postbot','radio','rocket','scout','toaster','tv'] loop
    perform filey_set_member_avatar(member_id,current_org(),'/avatars/mascots/'||mascot||'.webp');
    if (select avatar_override from filey_team_members() where id=member_id) is distinct from '/avatars/mascots/'||mascot||'.webp' then raise exception 'Mascot did not round trip: %',mascot; end if;
  end loop;
  foreach invalid in array array['https://tracking.invalid/avatars/mascots/fox.webp','//tracking.invalid/avatars/mascots/fox.webp','/avatars/mascots/unknown.webp','/avatars/mascots/fox-directions.webp','/avatars/mascots/fox-reactions.webp','/avatars/mascots/../fox.webp','/avatars/mascots/Fox.webp','/avatars/mascots/fox.webp?x=1',E'/avatars/mascots/fox.webp\n'] loop
    begin perform filey_set_member_avatar(member_id,current_org(),invalid); raise exception 'Invalid mascot accepted: %',invalid; exception when check_violation then null; end;
  end loop;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
do $$ declare self_id bigint; other_id bigint; begin
  select id into self_id from org_members where org_id=current_org() and user_id=auth.uid();
  select id into other_id from org_members where org_id=current_org() and user_id<>auth.uid() limit 1;
  perform filey_set_member_avatar(self_id,current_org(),'/avatars/mascots/fox.webp');
  begin perform filey_set_member_avatar(other_id,current_org(),'/avatars/mascots/fox.webp'); raise exception 'Staff changed another avatar'; exception when insufficient_privilege then null; end;
  begin perform filey_set_member_avatar(self_id,'wrong-workspace','/avatars/mascots/fox.webp'); raise exception 'Cross workspace avatar accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: 53 mascot choices round trip; invalid URLs, staff and cross-workspace changes are rejected.';
