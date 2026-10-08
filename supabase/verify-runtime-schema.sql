-- Read-only catalog snapshot for scripts/check-cloud-schema.mjs.
-- Contains schema metadata only, never business rows or authentication secrets.
-- Sources are limited to the new feature guards so migration order/drift can
-- be checked without exporting unrelated function bodies.
select jsonb_build_object(
 'columns',(select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',udt_name)) from information_schema.columns where table_schema='public'),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'args',oidvectortypes(p.proargtypes),'result',p.prorettype::regtype::text,
   'definer',p.prosecdef,'config',p.proconfig,'anon',has_function_privilege((select oid from pg_roles where rolname='anon'),p.oid,'execute'),
   'authenticated',has_function_privilege((select oid from pg_roles where rolname='authenticated'),p.oid,'execute'),
   'service_role',has_function_privilege((select oid from pg_roles where rolname='service_role'),p.oid,'execute'),
   'executor',has_function_privilege((select oid from pg_roles where rolname='filey_workflow_executor'),p.oid,'execute'),'owner',pg_get_userbyid(p.proowner),
   'source',case when p.proname in ('filey_setting_access','filey_record_stocktake','filey_letter_text_style_valid','filey_letter_form_format_valid','filey_validate_letter_setting',
     'filey_letter_rich_text_units','filey_letter_rich_node_stats','filey_letter_rich_document_valid',
     'filey_reserve_document_number','filey_document_numbers','filey_document_number_guard','filey_setting_number_guard',
     'filey_generate_recurring_invoice','filey_recurring_items_owned','filey_record_lead','filey_settle_stripe_checkout',
     'filey_workflow_children_owned','filey_workflow_totals',
     'filey_save_document','filey_document_lines_replaceable','log_audit','filey_audit_snapshot','preserve_einvoice_uuid',
     'filey_workflow_effects_owned','filey_workflow_receipt_reversible','filey_workflow_credit_available','filey_workflow_advance','filey_workflow_account_for_owner',
     'filey_workflow_guard','filey_workflow_account','filey_workflow_entry','filey_workflow_reverse','filey_workflow_stock','filey_workflow_unstock','filey_workflow_unpost','filey_workflow_post','filey_workflow_payment',
     'filey_business_workflow','filey_order_workflow','filey_journal_workflow','filey_advance_workflow','filey_stock_workflow',
     'filey_agent_workspace_allowed','prune_tool_runs','filey_ai_wallet') then p.prosrc end))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
 'tables',(select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,
   'authenticated',case when c.relname in ('app_settings','stocktake_requests','document_number_reservations','lead_setup_requests','business_workflow_requests','filey_bootstrap_migrations','ai_credit_orders') then
     (select jsonb_agg(privilege order by privilege) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege where has_table_privilege('authenticated',c.oid,privilege)) end,
   'anon',case when c.relname in ('stocktake_requests','document_number_reservations','lead_setup_requests','business_workflow_requests','filey_bootstrap_migrations','ai_credit_orders') then
     (select jsonb_agg(privilege order by privilege) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege where has_table_privilege('anon',c.oid,privilege)) end,
   'executor',case when c.relname='business_workflow_requests' and exists(select 1 from pg_roles where rolname='filey_workflow_executor') then
     (select jsonb_agg(privilege order by privilege) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege where has_table_privilege((select oid from pg_roles where rolname='filey_workflow_executor'),c.oid,privilege)) end))
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
 'triggers',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,
   'type',t.tgtype,'function',case when p.pronamespace='public'::regnamespace then p.proname::text else p.pronamespace::regnamespace::text || '.' || p.proname end,
   'condition',substring(pg_get_triggerdef(t.oid) from 'WHEN \((.*)\) EXECUTE FUNCTION'),
   'columns',(select jsonb_agg(a.attname order by col.ordinality) from unnest(t.tgattr) with ordinality col(attnum,ordinality) join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=col.attnum)))
   from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where n.nspname='public' and not t.tgisinternal),
 'indexes',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',idx.relname,'unique',i.indisunique,'valid',i.indisvalid,
   'predicate',pg_get_expr(i.indpred,i.indrelid),
   'columns',(select jsonb_agg(a.attname order by col.ordinality) from unnest(i.indkey) with ordinality col(attnum,ordinality) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=col.attnum where col.ordinality<=i.indnkeyatts)))
   from pg_index i join pg_class c on c.oid=i.indrelid join pg_class idx on idx.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('app_settings','stocktake_requests','document_number_reservations','lead_setup_requests','business_workflow_requests','filey_bootstrap_migrations','ai_credit_orders')),
 'policies',(select jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'command',cmd,'permissive',permissive,'roles',roles,'using',qual,'check',with_check))
   from pg_policies where schemaname='public' and tablename in ('app_settings','stocktake_requests','document_number_reservations','lead_setup_requests','business_workflow_requests','filey_bootstrap_migrations')),
 'roles',(select jsonb_agg(jsonb_build_object('name',r.rolname,'login',r.rolcanlogin,'superuser',r.rolsuper,'bypassrls',r.rolbypassrls,
   'createrole',r.rolcreaterole,'createdb',r.rolcreatedb,'replication',r.rolreplication,
   'authenticated_member',pg_has_role('authenticated',r.oid,'MEMBER'),'anon_member',pg_has_role('anon',r.oid,'MEMBER'),
   'service_role_member',pg_has_role('service_role',r.oid,'MEMBER'),'schema_create',has_schema_privilege(r.oid,'public','CREATE')))
   from pg_roles r where r.rolname='filey_workflow_executor'),
 'storage',jsonb_build_object(
   'rls',(select relrowsecurity from pg_class where oid='storage.objects'::regclass),
   'buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public)) from storage.buckets
     where id in ('files','tool-inputs','tool-outputs','team-attachments')),
   'policies',(select jsonb_agg(jsonb_build_object('name',policyname,'command',cmd,'permissive',permissive,'roles',roles,'using',qual,'check',with_check))
     from pg_policies where schemaname='storage' and tablename='objects')),
 'publication',(select jsonb_agg(tablename) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public')
) as catalog;
