// node --test scripts/test-runtime-schema-checks.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { featureFunctionSources, featureSchemaIssues, einvoiceSchemaIssues, hostedDraftSchemaIssues } from './runtime-schema-checks.mjs';

const migration = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
test('hosted draft catalog rejects exposed private helpers and stale numbering/snapshots', () => {
  const sources=featureFunctionSources(migration('2026-10-08-hosted-draft-parity.sql'));
  const catalog={functions:[
    ['filey_reserve_document_number_internal','text, text, integer, uuid, uuid, text','text',true,false],
    ['filey_channel_party_identity','jsonb','jsonb',false,false],
    ['filey_channel_create_draft','uuid, text, text, jsonb','jsonb',true,true],
  ].map(([name,args,result,definer,service_role])=>({name,args,result,definer,service_role,
    config:['search_path=public, pg_temp'],authenticated:false,anon:false,source:sources.get(name)}))};
  assert.deepEqual(hostedDraftSchemaIssues(catalog,sources),[]);
  for(const change of [c=>{c.functions[0].service_role=true;},c=>{c.functions[0].authenticated=true;},
    c=>{c.functions[2].source='begin return null; end;';},c=>{c.functions[2].anon=true;},c=>{c.functions.pop();}]) {
    const bad=structuredClone(catalog);change(bad);assert.notDeepEqual(hostedDraftSchemaIssues(bad,sources),[]);
  }
});
test('e-invoice schema audit detects lost UUID protection and incompatible preset columns', () => {
  const identitySources = featureFunctionSources(migration('2026-09-29-einvoice-identity.sql'));
  const identity = {
    columns: [['invoice_docs', 'einvoice'], ['company_profile', 'einvoice'], ['crm_customers', 'custom_fields'], ['suppliers', 'custom_fields']]
      .map(([table, column]) => ({ table, column, type: 'jsonb' })),
    functions: [{ name: 'preserve_einvoice_uuid', args: '', result: 'trigger', definer: false,
      config: ['search_path=public'], source: identitySources.get('preserve_einvoice_uuid') }],
    triggers: [{ table: 'invoice_docs', name: 'invoice_einvoice_identity', enabled: 'O', type: 23,
      function: 'preserve_einvoice_uuid', condition: null, columns: null }],
  };
  assert.deepEqual(einvoiceSchemaIssues(identity, identitySources), []);
  for (const breakContract of [
    value => { value.triggers = []; },
    value => { value.triggers[0].enabled = 'D'; },
    value => { value.triggers[0].type = 7; },
    value => { value.triggers[0].condition = 'false'; },
    value => { value.triggers[0].function = 'other_schema.preserve_einvoice_uuid'; },
    value => { value.functions[0].source = 'begin return new; end;'; },
    value => { value.functions[0].definer = true; },
    value => { value.columns[3].type = 'text'; },
  ]) {
    const broken = structuredClone(identity);
    breakContract(broken);
    assert.notDeepEqual(einvoiceSchemaIssues(broken, identitySources), []);
  }
});
const sources = featureFunctionSources(migration('2026-10-03-letters.sql'), migration('2026-10-03-stocktake-reliability.sql'), migration('2026-10-06-letter-rich-document.sql'));
const fixture = () => ({
  functions: [
    ['filey_can_use', 'text', 'boolean', true, false],
    ['filey_setting_access', 'text, boolean', 'boolean', true, false],
    ['filey_letter_text_style_valid', 'jsonb', 'boolean', false, true],
    ['filey_letter_rich_text_units', 'text', 'integer', false, false],
    ['filey_letter_rich_node_stats', 'jsonb, text, integer, integer', 'integer[]', false, false],
    ['filey_letter_rich_document_valid', 'jsonb', 'boolean', false, false],
    ['filey_letter_form_format_valid', 'jsonb', 'boolean', false, true],
    ['filey_validate_letter_setting', '', 'trigger', false, true],
    ['filey_record_stocktake', 'bigint, numeric, numeric, uuid', 'numeric', false, false],
  ].map(([name, args, result, definer, anon]) => ({ name, args, result, definer, anon,
    authenticated: true, config: ['search_path=public, pg_temp'], source: sources.get(name) ?? null })),
  tables: [
    { table: 'app_settings', rls: true, authenticated: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
    { table: 'stocktake_requests', rls: true, authenticated: ['SELECT', 'INSERT'], anon: null },
  ],
  indexes: [
    ['app_settings', 'app_settings_packaging_org_key', ['org_id', 'key'], "(key = 'packaging_lists'::text)"],
    ['app_settings', 'app_settings_letters_org_key', ['org_id', 'key'], "(key = 'letters'::text)"],
    ['app_settings', 'app_settings_user_setting_key', ['user_id', 'key'], "(key <> ALL (ARRAY['packaging_lists'::text, 'letters'::text]))"],
    ['stocktake_requests', 'stocktake_requests_pkey', ['org_id', 'user_id', 'request_id'], null],
  ].map(([table, name, columns, predicate]) => ({ table, name, columns, predicate, unique: true, valid: true })),
  policies: [
    ...['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map(command => ({
      table: 'app_settings', name: `filey_setting_${command.toLowerCase()}`, command, permissive: 'RESTRICTIVE', roles: ['authenticated'],
      [command === 'INSERT' ? 'check' : 'using']: `filey_setting_access(key, ${command === 'SELECT' ? 'false' : 'true'})`,
    })),
    ...[['stocktake_requests_read', 'SELECT', 'using'], ['stocktake_requests_insert', 'INSERT', 'check']].map(([name, command, field]) => ({
      table: 'stocktake_requests', name, command, permissive: 'PERMISSIVE', roles: ['authenticated'],
      [field]: "((user_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT current_org() AS current_org)) AND ( SELECT filey_can_use('inventory'::text) AS filey_can_use))",
    })),
  ],
  triggers: [{ table: 'app_settings', name: 'filey_letter_format', enabled: 'O', type: 23,
    function: 'filey_validate_letter_setting', condition: "(new.key = 'letters'::text)", columns: ['key', 'value'] }],
});
const check = catalog => featureSchemaIssues(catalog, sources);

test('accepts the current migrated catalog including safe pure validation functions', () => {
  assert.deepEqual(check(fixture()), []);
  assert.equal(sources.size, 8);
});
test('rejects a Packaging replay after Letters even when declaration_letters contains letters', () => {
  const catalog = fixture();
  catalog.functions.find(fn => fn.name === 'filey_setting_access').source = featureFunctionSources(migration('2026-10-01-packaging-lists.sql')).get('filey_setting_access');
  assert(catalog.functions.find(fn => fn.name === 'filey_setting_access').source.includes('declaration_letters'));
  assert.deepEqual(check(catalog), ['Feature function drift: filey_setting_access']);
});
test('requires the exact stocktake signature, invoker contract and effective RPC grants', () => {
  const catalog = fixture(), stocktake = catalog.functions.find(fn => fn.name === 'filey_record_stocktake');
  stocktake.definer = true; stocktake.authenticated = false; stocktake.anon = true;
  assert.deepEqual(check(catalog), [
    'Unexpected function contract: filey_record_stocktake(bigint, numeric, numeric, uuid)',
    'Missing authenticated function access: filey_record_stocktake(bigint, numeric, numeric, uuid)',
    'Unexpected anonymous function access: filey_record_stocktake(bigint, numeric, numeric, uuid)',
  ]);
  stocktake.args = 'bigint, numeric, numeric';
  assert.deepEqual(check(catalog), ['Missing function signature: filey_record_stocktake(bigint, numeric, numeric, uuid)']);
});
test('requires immutable scoped receipts and rejects broad table grants or RLS policies', () => {
  const catalog = fixture(), receipts = catalog.tables.find(table => table.table === 'stocktake_requests');
  receipts.rls = false; receipts.authenticated.push('DELETE'); receipts.anon = ['SELECT'];
  catalog.policies.push({ table: 'stocktake_requests', name: 'bypass', command: 'ALL', roles: ['public'], permissive: 'PERMISSIVE', using: 'true' });
  const issues = check(catalog);
  assert(issues.includes('Missing feature RLS: stocktake_requests'));
  assert(issues.includes('Unexpected stocktake receipt grants: authenticated must have SELECT and INSERT only'));
  assert(issues.includes('Unexpected stocktake receipt grants: anonymous access'));
  assert(issues.includes('Unexpected stocktake receipt policy: review extra access'));
  const receiptPolicy = catalog.policies.find(policy => policy.name === 'stocktake_requests_read');
  receiptPolicy.using += ' OR true';
  assert(check(catalog).includes('Missing or invalid stocktake receipt policy: stocktake_requests_read'));
});
test('rejects missing workspace uniqueness and the legacy per-user Letter constraint', () => {
  const catalog = fixture();
  catalog.indexes.find(index => index.name === 'app_settings_letters_org_key').columns = ['user_id', 'key'];
  catalog.indexes.find(index => index.name === 'app_settings_user_setting_key').predicate = "key <> 'packaging_lists'::text";
  catalog.indexes.find(index => index.name === 'stocktake_requests_pkey').columns = ['request_id'];
  assert.deepEqual(check(catalog), [
    'Missing or invalid feature unique index: app_settings_letters_org_key',
    'Missing or invalid feature unique index: app_settings_user_setting_key',
    'Missing or invalid feature unique index: stocktake_requests_pkey',
  ]);
});
test('requires restrictive authenticated settings gates for all four operations', () => {
  const catalog = fixture();
  catalog.policies.find(policy => policy.name === 'filey_setting_update').permissive = 'PERMISSIVE';
  catalog.policies.find(policy => policy.name === 'filey_setting_insert').check = 'true';
  assert.deepEqual(check(catalog), ['Missing or invalid settings module policy: INSERT', 'Missing or invalid settings module policy: UPDATE']);
});
test('rejects leftover global user/key indexes even when every expected partial index exists', () => {
  const catalog = fixture();
  catalog.indexes.push(
    { table: 'app_settings', name: 'app_settings_user_id_key_key', columns: ['user_id', 'key'], predicate: null, unique: true, valid: true },
    { table: 'app_settings', name: 'renamed_legacy_pair', columns: ['key', 'user_id'], predicate: null, unique: true, valid: true },
  );
  assert.deepEqual(check(catalog), [
    'Unexpected global settings uniqueness: app_settings_user_id_key_key',
    'Unexpected global settings uniqueness: renamed_legacy_pair',
  ]);
});
test('detects disabled, wrong-event or incomplete Letter formatting enforcement', () => {
  for (const change of [{ enabled: 'D' }, { enabled: 'R' }, { type: 19 }, { columns: ['key'] }, { condition: "new.key='declaration_letters'" }]) {
    const catalog = fixture();
    Object.assign(catalog.triggers[0], change);
    assert.deepEqual(check(catalog), ['Missing or invalid Letter formatting trigger']);
  }
  const catalog = fixture();
  catalog.functions.find(fn => fn.name === 'filey_validate_letter_setting').source = 'begin return new; end';
  assert.deepEqual(check(catalog), ['Feature function drift: filey_validate_letter_setting']);
});
test('fails closed on an older incomplete catalog export', () => {
  const catalog = fixture();
  delete catalog.indexes; delete catalog.policies;
  delete catalog.tables.find(table => table.table === 'stocktake_requests').anon;
  assert(check(catalog).includes('Missing stocktake anonymous grant metadata: rerun verify-runtime-schema.sql'));
  assert(check(catalog).includes('Missing or invalid feature unique index: app_settings_letters_org_key'));
  assert(check(catalog).includes('Missing or invalid settings module policy: SELECT'));
});

test('accepts the exact restrictive MFA receipt gate but rejects extra permissive or malformed authority', () => {
  const catalog=fixture();
  const policy={table:'stocktake_requests',name:'filey_mfa_required',command:'ALL',permissive:'RESTRICTIVE',roles:['authenticated'],using:'( SELECT public.filey_mfa_allowed() AS filey_mfa_allowed)',check:'( SELECT public.filey_mfa_allowed() AS filey_mfa_allowed)'};
  catalog.policies.push(policy);
  assert.deepEqual(check(catalog),[]);
  for (const change of [{permissive:'PERMISSIVE'},{roles:['public']},{using:'true'},{check:'true'},{command:'SELECT'}]) {
    const changed=structuredClone(catalog);
    Object.assign(changed.policies.at(-1),change);
    assert(check(changed).includes('Unexpected stocktake receipt policy: review extra access'));
  }
});
