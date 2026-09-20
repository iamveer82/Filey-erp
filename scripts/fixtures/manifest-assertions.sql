-- Uses the existing disposable permission fixtures, never a live workspace.
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
do $$ declare m jsonb; begin
  m:=public.filey_sync_manifest(array['products','orders']);
  if jsonb_array_length(m->'products')<>0 or jsonb_array_length(m->'orders')<>1 or m->'orders'->0->>'id'<>'1' then
    raise exception 'Manifest exposed private or cross-tenant products: %',m;
  end if;
  if m->'orders'->0 ? 'name' or m->'orders'->0 ? 'user_id' then
    raise exception 'Manifest returned record bodies';
  end if;
  if jsonb_array_length(public.filey_sync_manifest(array['orders'],1,1)->'orders')<>0 then
    raise exception 'Manifest pagination failed';
  end if;
  begin perform public.filey_sync_manifest(array['profiles']); raise exception 'Unexpected allow';
  exception when raise_exception then if sqlerrm='Unexpected allow' then raise; end if; end;
  begin perform public.filey_sync_manifest(array[null]::text[]); raise exception 'Unexpected allow';
  exception when raise_exception then if sqlerrm='Unexpected allow' then raise; end if; end;
  begin perform public.filey_sync_manifest(array['products'],0,1001); raise exception 'Unexpected allow';
  exception when raise_exception then if sqlerrm='Unexpected allow' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.filey_sync_manifest(text[],integer,integer)','execute') then
    raise exception 'Anonymous manifest access';
  end if;
end $$;
select 'PASS: batched metadata preserves RLS, excludes bodies, paginates, validates tables/limits and denies anonymous access.';
