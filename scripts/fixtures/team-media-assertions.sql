set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000002';
insert into storage.objects(bucket_id,name,metadata) values('team-attachments',
 '10000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000009.jpg','{"size":9,"mimetype":"image/jpeg"}');
set test.uid='00000000-0000-0000-0000-000000000003';
do $$ begin assert (select count(*) from storage.objects)=0,'Unsent attachments must not be readable by teammates'; end $$;
set test.uid='00000000-0000-0000-0000-000000000002';
insert into org_messages(id,channel,body) values(1000,'general','Public update');
insert into org_messages(id,channel,body,recipient_id,attachments) values(1001,'general','@owner Private',
 '00000000-0000-0000-0000-000000000003',
 '[{"path":"10000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000009.jpg","name":"Photo.jpg","size":9,"mime":"image/jpeg"}]');
do $$ begin
  assert jsonb_array_length(filey_message_page('general')->'rows')=1,'Channel feed must exclude direct messages';
  assert jsonb_array_length(filey_direct_message_page('00000000-0000-0000-0000-000000000003')->'rows')=1,'Sender reads direct conversation';
  delete from storage.objects;
  assert (select count(*) from storage.objects)=1,'A committed attachment cannot be removed by upload rollback';
  begin
    insert into org_messages(channel,body,recipient_id) values('general','Wrong workspace','00000000-0000-0000-0000-000000000004');
    assert false,'Cross-workspace direct message accepted';
  exception when raise_exception then null; end;
  begin
    insert into org_messages(channel,body,parent_id) values('general','Public reply to private conversation',1001);
    assert false,'Private thread leaked into a channel';
  exception when raise_exception then null; end;
  begin
    insert into org_messages(channel,body,attachments) select 'general','Forged size',jsonb_set(attachments,'{0,size}','999') from org_messages where id=1001;
    assert false,'Forged attachment metadata accepted';
  exception when raise_exception then null; end;
end $$;
set test.uid='00000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from org_messages)=1,'Workspace owner must not read another pair private messages';
  assert (select count(*) from storage.objects)=0,'Workspace owner must not read another pair attachments';
  assert jsonb_array_length(filey_direct_message_page('00000000-0000-0000-0000-000000000002')->'rows')=0,'Direct RPC cannot bypass participants';
end $$;
reset role;
do $$ begin
  assert not exists(select 1 from notifications where user_id='00000000-0000-0000-0000-000000000001'),'Private mentions must not notify outsiders';
  assert (select public=false and file_size_limit=10485760 from storage.buckets where id='team-attachments'),'Bucket must be private and size bounded';
end $$;
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000003';
do $$ begin
  assert (select count(*) from storage.objects)=1,'Recipient must be able to download attachment';
  assert (select unread from filey_unread_direct_messages() where person='00000000-0000-0000-0000-000000000002')=1,'Private message unread count';
  perform filey_mark_direct_read('00000000-0000-0000-0000-000000000002',1001);
  assert not exists(select 1 from filey_unread_direct_messages()),'Marking the private conversation read must clear its badge';
  insert into org_messages(channel,body,parent_id,recipient_id) values('general','Reply',1001,'00000000-0000-0000-0000-000000000002');
end $$;
reset role;
update org_members set modules=array['crm'] where user_id='00000000-0000-0000-0000-000000000003' and org_id='10000000-0000-0000-0000-000000000001';
set role authenticated;
set test.uid='00000000-0000-0000-0000-000000000003';
do $$ begin
  assert (select count(*) from storage.objects)=0,'Revoked team access must block files';
  assert (select count(*) from org_messages)=0,'Revoked team access must block messages';
end $$;
reset role;
select 'PASS: private team files, upload validation, direct-message isolation including admins, replies, read state and revoked access.';
