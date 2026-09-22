set role authenticated;
set test.uid = '00000000-0000-0000-0000-000000000001';
do $$ declare result jsonb; begin
  result := public.sync_records('products','[
    {"row":{"id":4503599627372000,"name":"First batch row","created_at":"2026-09-22T00:00:00Z"}},
    {"row":{"id":"invalid-integer","name":"Invalid"}},
    {"row":{"id":4503599627372001,"name":"Last batch row","created_at":"2026-09-22T00:00:00Z"}}
  ]');
  if jsonb_array_length(result) is distinct from 3 or result->0->>'revision' is distinct from '1'
    or result->1->'error'->>'code' is distinct from '22P02' or result->2->>'revision' is distinct from '1'
    then raise exception 'Batch did not isolate row failures: %',result; end if;
  result := public.sync_records('products','[
    {"row":{"id":4503599627372000,"name":"First batch row","created_at":"2026-09-22T00:00:00Z"}},
    {"row":{"id":4503599627372001,"name":"Stale change"},"expected":0}
  ]');
  if result->0->>'revision' is distinct from '1' or result->1->>'conflict' is distinct from 'true'
    then raise exception 'Legacy retry or revision check failed: %',result; end if;
  perform set_config('test.uid','00000000-0000-0000-0000-000000000005',false);
  result := public.sync_records('products','[{"row":{"id":4503599627372000,"name":"Other org"}}]');
  if result->0->>'conflict' is distinct from 'true' then raise exception 'Batch bypassed RLS'; end if;
end $$;
reset role;
select 'Batched sync preserves RLS, revision conflicts, idempotency and valid siblings' as result;
