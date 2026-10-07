import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {featureFunctionSources,workflowSchemaIssues} from './runtime-schema-checks.mjs';
const sources=featureFunctionSources(...['2026-10-04-atomic-document-save.sql','2026-10-04-document-number-authority.sql','2026-10-04-atomic-recurrence.sql','2026-10-04-atomic-business-workflows.sql','2026-10-04-atomic-lead-setup.sql','2026-10-04-stripe-invoice-total-parity.sql','2026-10-07-document-save-performance.sql']
  .map(name=>readFileSync(new URL('../supabase/'+name,import.meta.url),'utf8')));
const fields={
  document_number_reservations:['org_id','namespace','request_id','user_id','pattern','year','number','created_at'],
  lead_setup_requests:['request_id','payload','lead_id','result','created_at'],
  business_workflow_requests:['user_id','org_id','request_id','action','payload','result','created_at'],
  filey_bootstrap_migrations:['name','source_sha256','installed_at'],
};
const fixture=()=>({
  functions:[
    ['filey_reserve_document_number','text, text, integer, uuid, uuid, text','text',true,true,false],
    ['filey_generate_recurring_invoice','bigint, date, date, date, uuid, text','boolean',false,true,false],
    ['filey_recurring_items_owned','bigint, text','boolean',true,true,false],
    ['filey_workflow_children_owned','text, bigint, text','boolean',true,true,false],
    ['filey_workflow_totals','jsonb, jsonb, boolean','jsonb',false,true,false],
    ['filey_save_document','text, jsonb, jsonb, bigint','bigint',false,true,false],
    ['filey_document_lines_replaceable','text, bigint','boolean',true,true,false],
    ['filey_workflow_effects_owned','text, bigint, text','boolean',true,true,false],
    ['filey_workflow_receipt_reversible','text, bigint, bigint','boolean',true,true,false],
    ['filey_workflow_credit_available','text, bigint, uuid, text, numeric','boolean',true,true,false],
    ['filey_workflow_guard','uuid, text, text','void',false,false,false],
    ['filey_workflow_advance','jsonb, numeric, jsonb','void',false,false,false],
    ['filey_workflow_advance','jsonb, numeric','void',false,false,false],
    ['filey_workflow_account_for_owner','text, text, text, text, uuid','bigint',false,false,false],
    ['filey_workflow_account','text, text, text, text','bigint',false,false,false],
    ['filey_workflow_entry','bigint, text, numeric, text, text, text, date, bigint, bigint, bigint','bigint',false,false,false],
    ['filey_workflow_reverse','bigint[]','void',false,false,false],
    ['filey_workflow_stock','bigint, numeric, text, bigint, text, numeric','void',false,false,false],
    ['filey_workflow_unstock','text, bigint, text, uuid, jsonb, boolean, boolean','void',false,false,false],
    ['filey_workflow_unpost','text, jsonb, jsonb, boolean','void',false,false,false],
    ['filey_workflow_post','text, jsonb, jsonb, jsonb','void',false,false,false],
    ['filey_workflow_payment','text, jsonb, numeric, text, date, jsonb','bigint',false,false,false],
    ['filey_business_workflow','text, text, jsonb, uuid, uuid, text','jsonb',true,true,false,'filey_workflow_executor'],
    ...['order','journal','advance','stock'].map(k=>[`filey_${k}_workflow`,'text, jsonb, uuid, uuid, text','jsonb',true,true,false,'filey_workflow_executor']),
    ['filey_record_lead','uuid, text, text, text, text, text, text, text, text, timestamp with time zone','jsonb',false,false,true],
    ['filey_settle_stripe_checkout','text, text, uuid, bigint, numeric, text, text','jsonb',true,false,true],
    ['filey_document_numbers','text, text','record',true,false,false],
    ['filey_document_number_guard','','trigger',true,false,false],['filey_setting_number_guard','','trigger',true,false,false],
  ].map(([name,args,result,definer,authenticated,service_role,owner])=>({name,args,result,definer,authenticated,service_role,executor:true,owner:owner??'postgres',anon:false,config:['search_path=public, pg_temp'],source:sources.get(name==='filey_workflow_advance'?`${name}(${args.replaceAll(' ','')})`:name)})),
  columns:Object.entries(fields).flatMap(([table,cols])=>cols.map(column=>({table,column}))),
  tables:Object.keys(fields).map(table=>({table,rls:true,anon:null,authenticated:table==='business_workflow_requests'?['SELECT']:null,executor:table==='business_workflow_requests'?['INSERT','SELECT']:null})),
  roles:[{name:'filey_workflow_executor',login:false,superuser:false,bypassrls:false,createrole:false,createdb:false,replication:false,authenticated_member:false,anon_member:false,service_role_member:false,schema_create:false}],
  indexes:[['document_number_reservations',['org_id','namespace','request_id']],['document_number_reservations',['org_id','namespace','number']],['lead_setup_requests',['request_id']],['business_workflow_requests',['user_id','org_id','request_id']]]
    .map(([table,columns])=>({table,columns,unique:true,valid:true,predicate:null})),
  policies:[
    {table:'business_workflow_requests',name:'business_workflow_owner',command:'SELECT',permissive:'PERMISSIVE',roles:['authenticated'],using:'user_id=auth.uid() and org_id=public.current_org() and public.filey_is_workspace_member(org_id)'},
    {table:'business_workflow_requests',name:'business_workflow_insert',command:'INSERT',permissive:'PERMISSIVE',roles:['authenticated'],check:"user_id=auth.uid() and org_id=public.current_org() and public.filey_is_workspace_member(org_id) and length(action)<=64 and jsonb_typeof(payload)='object' and jsonb_typeof(result)='object' and octet_length(payload::text)<=8388608 and octet_length(result::text)<=2048"},
  ],
});
const check=c=>workflowSchemaIssues(c,sources);

test('the full catalog CLI treats only an absent fresh-installer ledger as optional',t=>{
  const directory=mkdtempSync(join(tmpdir(),'filey-catalog-check-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const run=catalog=>{
    const path=join(directory,'catalog.json');
    writeFileSync(path,JSON.stringify({rows:[{catalog}]}));
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('./check-cloud-schema.mjs',import.meta.url)),path],{
      cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',windowsHide:true,
    });
    assert.equal(result.status,1,'Other deliberately omitted app tables must still fail the CLI');
    assert.equal(result.stderr,'');
    return JSON.parse(result.stdout).issues;
  };
  const minimal=()=>({functions:[],columns:[],tables:[],triggers:[],publication:[],indexes:[],policies:[],roles:[]});
  const upgrade=run(minimal());
  assert(!upgrade.some(issue=>issue.includes('filey_bootstrap_migrations')||issue.includes('bootstrap ledger')),
    'A supported upgraded database must not be told to install fresh-only tracking');
  assert(upgrade.includes('Missing table: app_settings'),'Required business tables cannot be made optional');
  assert(upgrade.includes('Missing column: app_settings.key'),'Required business columns must still be checked');

  const partial=minimal();
  partial.tables.push({table:'filey_bootstrap_migrations',rls:false,authenticated:['SELECT'],anon:null});
  const invalid=run(partial);
  assert(invalid.includes('Missing column: filey_bootstrap_migrations.name'));
  assert(invalid.includes('Missing column: filey_bootstrap_migrations.installed_at'));
  assert(invalid.includes('Missing bootstrap ledger column: source_sha256'));
  assert(invalid.includes('Unexpected bootstrap ledger authority'),'Presence never exempts ledger privacy');

  partial.tables[0]={table:'filey_bootstrap_migrations',rls:true,authenticated:null,anon:null};
  partial.columns=['name','source_sha256','installed_at'].map(column=>({table:'filey_bootstrap_migrations',column}));
  const tracked=run(partial);
  assert(!tracked.some(issue=>issue.includes('filey_bootstrap_migrations')||issue.includes('bootstrap ledger')),
    'A complete private fresh-installer ledger remains supported');
});
test('accepts exact current RPCs, private ledgers, narrow role and scoped immutable receipts',()=>assert.deepEqual(check(fixture()),[]));

test('the real catalog exporter includes every checked workflow source body',()=>{
  const exporter=readFileSync(new URL('../supabase/verify-runtime-schema.sql',import.meta.url),'utf8');
  const sourceNames=exporter.match(/'source',case when p\.proname in \(([\s\S]*?)\) then p\.prosrc end/)?.[1];
  assert(sourceNames,'Catalog source whitelist is missing');
  for(const fn of fixture().functions)
    assert(sourceNames.includes("'"+fn.name+"'"),'Catalog omits source body: '+fn.name);
});
test('detects every new RPC stale signature, missing grant and body drift',()=>{
  for(const fn of fixture().functions) {
    const c=fixture(),f=c.functions.find(x=>x.name===fn.name&&x.args===fn.args);f.args+=' , bigint';
    assert(check(c).some(i=>i.startsWith('Missing workflow signature: '+fn.name)));
    f.args=fn.args;f.anon=true;assert(check(c).includes('Unexpected workflow function grants: '+fn.name));
    f.anon=false;f.source='begin return null; end';assert(check(c).includes('Workflow function drift: '+fn.name));
  }
  const c=fixture();c.functions.push({...c.functions[0],args:'text, text, integer, uuid, text, text'});
  assert(check(c).includes('Unexpected workflow overload: filey_reserve_document_number'));
});

test('checks both intentional advance overloads and rejects an extra or obsolete weaker body',()=>{
  const c=fixture(),wrapper=c.functions.find(f=>f.name==='filey_workflow_advance'&&f.args==='jsonb, numeric');
  assert(wrapper.source.includes('filey_workflow_advance(p_doc,p_amount,null)'));
  wrapper.source='begin delete from advances; end';
  assert(check(c).includes('Workflow function drift: filey_workflow_advance'));
  wrapper.source=sources.get('filey_workflow_advance(jsonb,numeric)');
  c.functions.push({...wrapper,args:'jsonb, numeric, boolean'});
  assert(check(c).includes('Unexpected workflow overload: filey_workflow_advance'));
  const missing=fixture();missing.functions=missing.functions.filter(f=>!(f.name==='filey_workflow_advance'&&f.args==='jsonb, numeric, jsonb'));
  assert(check(missing).some(i=>i.startsWith('Missing workflow signature: filey_workflow_advance(jsonb, numeric, jsonb)')));
});

test('receipt cost integrity remains an authenticated boolean helper with its privileged source',()=>{
  const c=fixture(),fn=c.functions.find(f=>f.name==='filey_workflow_receipt_reversible');
  assert(fn.source.includes('filey_workflow_effects_owned'));
  assert(fn.source.includes("filey_can_use('inventory')"));
  assert(fn.source.includes('id>v_first'));
  fn.authenticated=false;
  assert(check(c).includes('Unexpected workflow function grants: '+fn.name));
  fn.authenticated=true;fn.definer=false;
  assert(check(c).includes('Unexpected workflow function contract: '+fn.name));
  fn.definer=true;fn.result='numeric';
  assert(check(c).includes('Unexpected workflow function contract: '+fn.name));
});

test('every mutating helper rejects direct client/service execution and requires the executor grant',()=>{
  const internal=fixture().functions.filter(f=>f.name.startsWith('filey_workflow_')&&!f.authenticated);
  assert.equal(internal.length,12);
  for(const fn of internal) for(const change of [{authenticated:true},{service_role:true},{executor:false},{executor:null}]) {
    const c=fixture(),f=c.functions.find(x=>x.name===fn.name&&x.args===fn.args);
    Object.assign(f,change);
    assert(check(c).includes('Unexpected workflow function grants: '+fn.name));
  }
});
test('requires invoker lead+recurrence, authenticated allocator and service-only lead setup',()=>{
  for(const name of ['filey_generate_recurring_invoice','filey_record_lead']) {
    const c=fixture();c.functions.find(f=>f.name===name).definer=true;
    assert(check(c).includes('Unexpected workflow function contract: '+name));
  }
  for(const name of ['filey_record_lead','filey_settle_stripe_checkout']) for(const change of [{authenticated:true},{service_role:false},{anon:true}]) {
    const c=fixture();Object.assign(c.functions.find(f=>f.name===name),change);
    assert(check(c).includes('Unexpected workflow function grants: '+name));
  }
  const c=fixture();c.functions.find(f=>f.name==='filey_reserve_document_number').authenticated=false;
  assert(check(c).includes('Unexpected workflow function grants: filey_reserve_document_number'));
});
test('refuses elevated or client-accessible workflow execution role and wrong definer owner',()=>{
  for(const key of ['login','superuser','bypassrls','createrole','createdb','replication','authenticated_member','anon_member','service_role_member','schema_create']) {
    const c=fixture();c.roles[0][key]=true;assert(check(c).includes('Unsafe or missing workflow execution role'));
  }
  const c=fixture();c.functions.find(f=>f.name==='filey_business_workflow').owner='postgres';
  assert(check(c).includes('Unexpected workflow function contract: filey_business_workflow'));
});
test('private ledgers reject client grants, missing role metadata and missing RLS',()=>{
  for(const table of ['document_number_reservations','lead_setup_requests']) {
    const c=fixture(),t=c.tables.find(t=>t.table===table);t.authenticated=['SELECT'];t.anon=['INSERT'];t.rls=false;
    assert(check(c).includes('Unexpected workflow table grants: '+table+' authenticated'));
    assert(check(c).includes('Unexpected workflow table grants: '+table+' anonymous'));
    assert(check(c).includes('Missing workflow RLS: '+table));
    delete t.anon;assert(check(c).includes('Unexpected workflow table grants: '+table+' anonymous'));
  }
});
test('rejects mutable client receipts, broad policies and lost request/workspace uniqueness',()=>{
  const c=fixture();c.tables.find(t=>t.table==='business_workflow_requests').authenticated.push('UPDATE');
  c.policies[0].using+=' or true';c.indexes.pop();
  assert(check(c).includes('Unexpected workflow table grants: business_workflow_requests authenticated'));
  assert(check(c).includes('Missing or invalid workflow receipt read policy'));
  assert(check(c).some(i=>i.startsWith('Missing workflow uniqueness: business_workflow_requests')));
  c.policies.push({table:'lead_setup_requests',name:'public-read',using:'true'});
  assert(check(c).includes('Unexpected private ledger policy: lead_setup_requests'));
  c.policies.find(p=>p.name==='business_workflow_insert').check+=' OR true';
  assert(check(c).includes('Missing or invalid workflow receipt insert policy'));
});
test('bootstrap ledger is optional for upgrades but private and hashed when present',()=>{
  const c=fixture();c.tables=c.tables.filter(t=>t.table!=='filey_bootstrap_migrations');assert.deepEqual(check(c),[]);
  const bad=fixture();bad.tables.find(t=>t.table==='filey_bootstrap_migrations').authenticated=['SELECT'];
  bad.columns=bad.columns.filter(c=>c.column!=='source_sha256');
  assert(check(bad).includes('Unexpected bootstrap ledger authority'));
  assert(check(bad).includes('Missing bootstrap ledger column: source_sha256'));
});
