import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { featureFunctionSources, privacySchemaIssues } from './runtime-schema-checks.mjs';
const sources=featureFunctionSources(...['cloud-storage-privacy','scheduled-agent-privacy'].map(name=>readFileSync(new URL(`../supabase/2026-10-04-${name}.sql`,import.meta.url),'utf8')));
const fixture=()=>({
  functions:[['prune_tool_runs','interval',true,'public,storage'],['filey_agent_workspace_allowed','uuid, text',false,'public,pg_temp']]
    .map(([name,args,definer,path])=>({name,args,definer,config:[`search_path=${path}`],anon:false,authenticated:false,service_role:true,source:sources.get(name)})),
  storage:{rls:true,buckets:['files','tool-inputs','tool-outputs','team-attachments'].map(id=>({id,public:false})),policies:[{
    name:'filey_mfa_required',command:'ALL',permissive:'RESTRICTIVE',roles:['authenticated'],
    using:'( SELECT filey_mfa_allowed() AS filey_mfa_allowed)',check:'( SELECT filey_mfa_allowed() AS filey_mfa_allowed)',
  }]},
});
test('accepts private bucket metadata and service-only exact maintenance/delivery helpers',()=>assert.deepEqual(privacySchemaIssues(fixture(),sources),[]));
test('rejects missing/public buckets even while objects RLS is enabled',()=>{
  for(const id of ['files','tool-inputs','tool-outputs','team-attachments']) {
    const c=fixture();c.storage.buckets.find(b=>b.id===id).public=true;
    assert.deepEqual(privacySchemaIssues(c,sources),[`Missing or public private bucket: ${id}`]);
  }
  const c=fixture();c.storage.buckets=[];assert.equal(privacySchemaIssues(c,sources).length,4);
});
test('rejects retained authenticated/PUBLIC/anonymous maintenance Execute and lost service grants',()=>{
  for(const name of ['prune_tool_runs','filey_agent_workspace_allowed']) for(const [key,value] of [['authenticated',true],['anon',true],['service_role',false]]) {
    const c=fixture();c.functions.find(f=>f.name===name)[key]=value;
    assert.deepEqual(privacySchemaIssues(c,sources),[`Unexpected private service grants: ${name}`]);
  }
});
test('rejects unscoped legacy retention body and wrong scheduled workspace function body',()=>{
  for(const name of ['prune_tool_runs','filey_agent_workspace_allowed']) {
    const c=fixture();c.functions.find(f=>f.name===name).source='begin return; end';
    assert.deepEqual(privacySchemaIssues(c,sources),[`Private service function drift: ${name}`]);
  }
});
test('rejects disabled storage RLS or missing/weakened MFA gates',()=>{
  const c=fixture();c.storage.rls=false;c.storage.policies[0].permissive='PERMISSIVE';
  assert.deepEqual(privacySchemaIssues(c,sources),['Missing private storage RLS','Missing private storage MFA gate']);
  c.storage.rls=true;c.storage.policies=[];assert.deepEqual(privacySchemaIssues(c,sources),['Missing private storage MFA gate']);
});
test('rejects stale overloads or definer elevation of service invoker helper',()=>{
  const c=fixture();c.functions[1].definer=true;
  assert.deepEqual(privacySchemaIssues(c,sources),['Unexpected private service function: filey_agent_workspace_allowed']);
  c.functions[1].definer=false;c.functions.push({...c.functions[0],args:''});
  assert.deepEqual(privacySchemaIssues(c,sources),['Unexpected private service function: prune_tool_runs']);
});
