create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select,insert,delete on storage.objects to authenticated;
insert into org_members(org_id,user_id,role,modules) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','staff',array['team']),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','staff',array['team']);
update profiles set org_id='10000000-0000-0000-0000-000000000001' where id in ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
