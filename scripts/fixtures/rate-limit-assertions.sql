do $$ begin
  if has_function_privilege('authenticated','public.filey_take_rate_limit(text,text,integer,integer)','execute')
    or has_function_privilege('anon','public.filey_take_rate_limit(text,text,integer,integer)','execute')
    or has_table_privilege('authenticated','public.edge_rate_limits','select,insert,update,delete') then
    raise exception 'Counter exposed to app clients';
  end if;
end $$;
set role service_role;
do $$ begin
  for n in 1..5 loop
    if not filey_take_rate_limit('web:buyer@example.invalid','checkout',5,3600) then raise exception 'Early throttle'; end if;
  end loop;
  if filey_take_rate_limit('web:buyer@example.invalid','checkout',5,3600) then raise exception 'Limit exceeded'; end if;
  if not filey_take_rate_limit('web:other@example.invalid','checkout',5,3600) then raise exception 'Identity not isolated'; end if;
  if not filey_take_rate_limit('web:buyer@example.invalid','email',5,3600) then raise exception 'Action not isolated'; end if;
  begin perform filey_take_rate_limit('buyer','checkout',0,3600); raise exception 'Invalid budget accepted';
    exception when raise_exception then if sqlerrm='Invalid budget accepted' then raise; end if; end;
end $$;
reset role;
update edge_rate_limits set started_at=clock_timestamp()-interval '2 hours' where action='checkout';
set role service_role;
do $$ begin
  if not filey_take_rate_limit('web:buyer@example.invalid','checkout',5,3600) then raise exception 'Window did not reset'; end if;
end $$;
reset role;
select 'PASS: service-only atomic rate budgets, text identities, isolation, validation and window reset.';
