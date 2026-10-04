// Feature-specific catalog checks. These do not read or change business rows.
const compact = value => (value ?? '').replace(/::text\b/gi, '').replace(/[\s()]/g, '').toLowerCase();
const sourceText = value => (value ?? '').replace(/--[^\r\n]*/g, '').trim().replace(/\s+/g, ' ');
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

// Effective grants and bucket flags are runtime metadata. Reading SQL source
// alone cannot detect an old public bucket or managed default EXECUTE grant.
export function privacySchemaIssues(catalog, sources = new Map()) {
  const issues = [];
  const storage = catalog.storage;
  if (storage?.rls !== true) issues.push('Missing private storage RLS');
  for (const id of ['files','tool-inputs','tool-outputs','team-attachments']) {
    if (storage?.buckets?.find(bucket => bucket.id === id)?.public !== false)
      issues.push(`Missing or public private bucket: ${id}`);
  }
  const mfa = storage?.policies?.find(policy => policy.name === 'filey_mfa_required');
  const mfaExpr = value => compact((value ?? '').replace(/\bAS\s+[a-z_]+\b/gi, '')).replaceAll('public.','');
  if (mfa?.command !== 'ALL' || mfa.permissive !== 'RESTRICTIVE' || !same(mfa.roles,['authenticated'])
    || ['using','check'].some(field => mfaExpr(mfa[field]) !== 'selectfiley_mfa_allowed'))
    issues.push('Missing private storage MFA gate');
  for (const [name, args, definer] of [['prune_tool_runs','interval',true],['filey_agent_workspace_allowed','uuid, text',false]]) {
    const found = (catalog.functions ?? []).filter(fn => fn.name === name);
    const fn = found.find(fn => compact(fn.args) === compact(args));
    if (found.length !== 1 || !fn || fn.definer !== definer
      || !fn.config?.some(config => compact(config) === (definer ? 'search_path=public,storage' : 'search_path=public,pg_temp')))
      issues.push(`Unexpected private service function: ${name}`);
    if (fn && (fn.authenticated !== false || fn.anon !== false || fn.service_role !== true))
      issues.push(`Unexpected private service grants: ${name}`);
    if (sources.has(name) && sourceText(fn?.source) !== sourceText(sources.get(name)))
      issues.push(`Private service function drift: ${name}`);
  }
  return issues;
}

export function creditPromotionSchemaIssues(catalog, sources = new Map()) {
  const issues=[];
  const table=(catalog.tables??[]).find(item=>item.table==='ai_credit_orders');
  if(table?.rls!==true) issues.push('Missing private Coin order RLS');
  for(const role of ['authenticated','anon']) {
    if(!table||!Object.hasOwn(table,role)||(table[role]??[]).length) issues.push(`Unexpected private Coin order grants: ${role}`);
  }
  for(const [column,type] of Object.entries({promotion_id:'uuid',promotion_discount_id:'text',promotion_discount_code:'text',
    promotion_customer_id:'text',promotion_email:'text',promotion_expires_at:'timestamptz',expected_paid_cents:'int8',checkout_session_id:'text',checkout_url:'text'})) {
    if(!(catalog.columns??[]).some(item=>item.table==='ai_credit_orders'&&item.column===column&&item.type===type))
      issues.push(`Missing Coin promotion column: ${column}`);
  }
  for(const [name,column] of [['ai_credit_promotion_once','promotion_id'],['ai_credit_promotion_discount_once','promotion_discount_id']]) {
    if(!(catalog.indexes??[]).some(item=>item.table==='ai_credit_orders'&&item.name===name&&item.unique&&item.valid&&
      same(item.columns,[column])&&compact(item.predicate)==='promotion_idisnotnull')) issues.push(`Missing Coin promotion uniqueness: ${name}`);
  }
  const found=(catalog.functions??[]).filter(item=>item.name==='filey_ai_wallet');
  const fn=found[0];
  if(found.length!==1||compact(fn?.args)!=='text,uuid,jsonb'||fn.result!=='jsonb'||fn.definer!==true||
    !fn.config?.some(value=>compact(value)==='search_path=public,pg_temp')||fn.authenticated!==false||fn.anon!==false||fn.service_role!==true)
    issues.push('Unexpected private Coin wallet contract');
  if(sources.has('filey_ai_wallet')&&sourceText(fn?.source)!==sourceText(sources.get('filey_ai_wallet')))
    issues.push('Coin promotion wallet function drift');
  return issues;
}

export function featureFunctionSources(...migrations) {
  const sources = new Map();
  for (const sql of migrations)
    for (const match of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\([\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$;/gi)) {
      sources.set(match[1], match[2]);
      // This helper intentionally has two fixed overloads. Compare each body,
      // including the compatibility wrapper, instead of only its final name.
      if(match[1]==='filey_workflow_advance') {
        const parameters=match[0].match(/filey_workflow_advance\(([^)]*)\)/i)?.[1];
        const args=parameters?.split(',').map(p=>p.trim().replace(/^\w+\s+/,'')).join(',');
        if(args) sources.set(`${match[1]}(${compact(args)})`,match[2]);
      }
    }
  return sources;
}

export function featureSchemaIssues(catalog, sources) {
  const issues = [];
  const tables = new Map((catalog.tables ?? []).map(table => [table.table, table]));
  const indexes = catalog.indexes ?? [], policies = catalog.policies ?? [];
  const requireFunction = (name, args, result, definer, privateRpc = false) => {
    const matches = (catalog.functions ?? []).filter(fn => fn.name === name && compact(fn.args) === compact(args));
    if (matches.length !== 1) { issues.push(`Missing function signature: ${name}(${args})`); return; }
    const fn = matches[0];
    if (fn.result !== result || fn.definer !== definer || !fn.config?.some(value => compact(value) === 'search_path=public,pg_temp'))
      issues.push(`Unexpected function contract: ${name}(${args})`);
    if (fn.authenticated !== true) issues.push(`Missing authenticated function access: ${name}(${args})`);
    if (privateRpc && fn.anon !== false) issues.push(`Unexpected anonymous function access: ${name}(${args})`);
    if (sources.has(name) && sourceText(fn.source) !== sourceText(sources.get(name)))
      issues.push(`Feature function drift: ${name}`);
  };
  requireFunction('filey_can_use', 'text', 'boolean', true, true);
  requireFunction('filey_setting_access', 'text, boolean', 'boolean', true, true);
  requireFunction('filey_letter_text_style_valid', 'jsonb', 'boolean', false);
  requireFunction('filey_letter_form_format_valid', 'jsonb', 'boolean', false);
  requireFunction('filey_validate_letter_setting', '', 'trigger', false);
  requireFunction('filey_record_stocktake', 'bigint, numeric, numeric, uuid', 'numeric', false, true);

  for (const name of ['app_settings', 'stocktake_requests'])
    if (!tables.get(name)?.rls) issues.push(`Missing feature RLS: ${name}`);
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
    if (!tables.get('app_settings')?.authenticated?.includes(privilege))
      issues.push(`Missing authenticated table access: app_settings ${privilege}`);
  if (!same([...(tables.get('stocktake_requests')?.authenticated ?? [])].sort(), ['INSERT', 'SELECT']))
    issues.push('Unexpected stocktake receipt grants: authenticated must have SELECT and INSERT only');
  if (!tables.get('stocktake_requests') || !Object.hasOwn(tables.get('stocktake_requests'), 'anon'))
    issues.push('Missing stocktake anonymous grant metadata: rerun verify-runtime-schema.sql');
  else if ((tables.get('stocktake_requests').anon ?? []).length)
    issues.push('Unexpected stocktake receipt grants: anonymous access');

  const requireIndex = (table, name, columns, predicate) => {
    const index = indexes.find(item => item.table === table && item.name === name);
    if (!index?.unique || !index.valid || !same(index.columns, columns) || !predicate(compact(index.predicate)))
      issues.push(`Missing or invalid feature unique index: ${name}`);
  };
  requireIndex('app_settings', 'app_settings_packaging_org_key', ['org_id', 'key'], value => value === "key='packaging_lists'");
  requireIndex('app_settings', 'app_settings_letters_org_key', ['org_id', 'key'], value => value === "key='letters'");
  requireIndex('app_settings', 'app_settings_user_setting_key', ['user_id', 'key'], value =>
    ["key<>allarray['packaging_lists','letters']", "key<>allarray['letters','packaging_lists']",
      "keynotin'packaging_lists','letters'", "keynotin'letters','packaging_lists'"].includes(value));
  requireIndex('stocktake_requests', 'stocktake_requests_pkey', ['org_id', 'user_id', 'request_id'], value => value === '');
  for (const index of indexes)
    if (index.table === 'app_settings' && index.unique && index.predicate == null && same([...(index.columns ?? [])].sort(), ['key', 'user_id']))
      issues.push(`Unexpected global settings uniqueness: ${index.name}`);

  for (const command of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const policy = policies.find(item => item.table === 'app_settings' && item.name === `filey_setting_${command.toLowerCase()}`);
    const expression = command === 'INSERT' ? policy?.check : policy?.using;
    const expected = `filey_setting_accesskey,${command === 'SELECT' ? 'false' : 'true'}`;
    if (policy?.command !== command || policy.permissive !== 'RESTRICTIVE' || !same(policy.roles, ['authenticated']) || compact(expression).replace(/^public\./, '') !== expected)
      issues.push(`Missing or invalid settings module policy: ${command}`);
  }
  for (const [name, command, field] of [['stocktake_requests_read', 'SELECT', 'using'], ['stocktake_requests_insert', 'INSERT', 'check']]) {
    const policy = policies.find(item => item.table === 'stocktake_requests' && item.name === name);
    const expression = compact((policy?.[field] ?? '').replace(/\bAS\s+[a-z_]+\b/gi, '')).replaceAll('public.', '');
    const expected = "user_id=selectauth.uidandorg_id=selectcurrent_organdselectfiley_can_use'inventory'";
    if (policy?.command !== command || policy.permissive !== 'PERMISSIVE' || !same(policy.roles, ['authenticated']) || expression !== expected)
      issues.push(`Missing or invalid stocktake receipt policy: ${name}`);
  }
  const safeReceiptMfa = policy => policy.name === 'filey_mfa_required'
    && policy.command === 'ALL' && policy.permissive === 'RESTRICTIVE' && same(policy.roles, ['authenticated'])
    && ['using', 'check'].every(field => compact((policy[field] ?? '').replace(/\bAS\s+[a-z_]+\b/gi, '')).replaceAll('public.', '') === 'selectfiley_mfa_allowed');
  if (policies.some(policy => policy.table === 'stocktake_requests' && !['stocktake_requests_read', 'stocktake_requests_insert'].includes(policy.name) && !safeReceiptMfa(policy)))
    issues.push('Unexpected stocktake receipt policy: review extra access');

  const trigger = (catalog.triggers ?? []).find(item => item.table === 'app_settings' && item.name === 'filey_letter_format');
  if (!trigger || !['O', 'A'].includes(trigger.enabled) || trigger.type !== 23 || trigger.function !== 'filey_validate_letter_setting'
    || compact(trigger.condition) !== "new.key='letters'" || (trigger.columns?.length && !['key', 'value'].every(column => trigger.columns.includes(column))))
    issues.push('Missing or invalid Letter formatting trigger');
  return issues;
}

// New workflow signatures and effective grants are explicit: finding a RPC
// name alone cannot detect a stale overload or accidental public execution.
export function workflowSchemaIssues(catalog,sources) {
  const issues=[],tables=new Map((catalog.tables??[]).map(t=>[t.table,t]));
  const columns=new Set((catalog.columns??[]).map(c=>`${c.table}.${c.column}`));
  const internalMutators=new Set(['filey_workflow_guard','filey_workflow_account_for_owner','filey_workflow_account','filey_workflow_entry','filey_workflow_reverse',
    'filey_workflow_stock','filey_workflow_unstock','filey_workflow_unpost','filey_workflow_post','filey_workflow_advance','filey_workflow_payment']);
  const functions=[
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
    ...['order','journal','advance','stock'].map(kind=>[`filey_${kind}_workflow`,'text, jsonb, uuid, uuid, text','jsonb',true,true,false,'filey_workflow_executor']),
    ['filey_record_lead','uuid, text, text, text, text, text, text, text, text, timestamp with time zone','jsonb',false,false,true],
    ['filey_settle_stripe_checkout','text, text, uuid, bigint, numeric, text, text','jsonb',true,false,true],
    ['filey_document_numbers','text, text','record',true,false,false],
    ['filey_document_number_guard','','trigger',true,false,false],
    ['filey_setting_number_guard','','trigger',true,false,false],
  ];
  const expectedOverloads=new Map();
  for(const [name] of functions) expectedOverloads.set(name,(expectedOverloads.get(name)??0)+1);
  for(const [name,args,result,definer,authenticated,service,owner] of functions) {
    if((catalog.functions??[]).filter(f=>f.name===name).length>expectedOverloads.get(name)) issues.push(`Unexpected workflow overload: ${name}`);
    const matches=(catalog.functions??[]).filter(f=>f.name===name&&compact(f.args)===compact(args));
    if(matches.length!==1) {issues.push(`Missing workflow signature: ${name}(${args})`);continue;}
    const fn=matches[0];
    if(fn.result!==result || fn.definer!==definer || !fn.config?.some(v=>compact(v)==='search_path=public,pg_temp') || (owner&&fn.owner!==owner))
      issues.push(`Unexpected workflow function contract: ${name}`);
    if(fn.anon!==false || fn.authenticated!==authenticated || (service&&fn.service_role!==true)
      || (internalMutators.has(name)&&(fn.executor!==true||fn.service_role!==false)))
      issues.push(`Unexpected workflow function grants: ${name}`);
    const sourceKey=name==='filey_workflow_advance'?`${name}(${compact(args)})`:name;
    if(sources.has(sourceKey)&&sourceText(fn.source)!==sourceText(sources.get(sourceKey))) issues.push(`Workflow function drift: ${name}`);
  }
  const requiredColumns={
    document_number_reservations:['org_id','namespace','request_id','user_id','pattern','year','number','created_at'],
    lead_setup_requests:['request_id','payload','lead_id','result','created_at'],
    business_workflow_requests:['user_id','org_id','request_id','action','payload','result','created_at'],
  };
  for(const [table,fields] of Object.entries(requiredColumns)) {
    const actual=tables.get(table);
    if(!actual?.rls) issues.push(`Missing workflow RLS: ${table}`);
    for(const field of fields) if(!columns.has(`${table}.${field}`)) issues.push(`Missing workflow column: ${table}.${field}`);
    const expected=table==='business_workflow_requests'?['SELECT']:[];
    if(!actual || !Object.hasOwn(actual,'authenticated') || !same([...(actual.authenticated??[])].sort(),expected))
      issues.push(`Unexpected workflow table grants: ${table} authenticated`);
    if(!actual || !Object.hasOwn(actual,'anon') || (actual.anon??[]).length)
      issues.push(`Unexpected workflow table grants: ${table} anonymous`);
  }
  const ledger=tables.get('filey_bootstrap_migrations');
  // The private installer ledger exists only on fresh/tracked databases, not
  // upgrades of existing deployments; when present its privacy is mandatory.
  if(ledger) {
    if(!ledger.rls || !Object.hasOwn(ledger,'authenticated') || (ledger.authenticated??[]).length
      || !Object.hasOwn(ledger,'anon') || (ledger.anon??[]).length)
      issues.push('Unexpected bootstrap ledger authority');
    for(const column of ['name','source_sha256','installed_at']) if(!columns.has(`filey_bootstrap_migrations.${column}`)) issues.push(`Missing bootstrap ledger column: ${column}`);
  }
  const role=(catalog.roles??[]).find(r=>r.name==='filey_workflow_executor');
  if(!role || ['login','superuser','bypassrls','createrole','createdb','replication','authenticated_member','anon_member','service_role_member','schema_create'].some(key=>role[key]!==false))
    issues.push('Unsafe or missing workflow execution role');
  if(!same([...(tables.get('business_workflow_requests')?.executor??[])].sort(),['INSERT','SELECT']))
    issues.push('Unexpected workflow receipt executor grants');
  for(const [table,fields] of [
    ['document_number_reservations',['org_id','namespace','request_id']],
    ['document_number_reservations',['org_id','namespace','number']],
    ['lead_setup_requests',['request_id']],['business_workflow_requests',['user_id','org_id','request_id']],
  ]) if(!(catalog.indexes??[]).some(i=>i.table===table&&i.unique&&i.valid&&i.predicate==null&&same(i.columns,fields)))
    issues.push(`Missing workflow uniqueness: ${table}(${fields.join(',')})`);
  const policies=(catalog.policies??[]).filter(p=>p.table==='business_workflow_requests');
  const owner=policies.find(p=>p.name==='business_workflow_owner');
  const expression=compact(owner?.using).replaceAll('public.','');
  if(owner?.command!=='SELECT' || owner.permissive!=='PERMISSIVE' || !same(owner.roles,['authenticated'])
    || expression!=='user_id=auth.uidandorg_id=current_organdfiley_is_workspace_memberorg_id')
    issues.push('Missing or invalid workflow receipt read policy');
  const insert=policies.find(p=>p.name==='business_workflow_insert');
  if(insert?.command!=='INSERT' || insert.permissive!=='PERMISSIVE' || !same(insert.roles,['authenticated'])
    || compact(insert.check).replaceAll('public.','')!=="user_id=auth.uidandorg_id=current_organdfiley_is_workspace_memberorg_idandlengthaction<=64andjsonb_typeofpayload='object'andjsonb_typeofresult='object'andoctet_lengthpayload<=8388608andoctet_lengthresult<=2048")
    issues.push('Missing or invalid workflow receipt insert policy');
  const safeMfa=p=>p.name==='filey_mfa_required'&&p.command==='ALL'&&p.permissive==='RESTRICTIVE'&&same(p.roles,['authenticated'])
    && ['using','check'].every(k=>compact((p[k]??'').replace(/\bAS\s+[a-z_]+\b/gi,'')).replaceAll('public.','')==='selectfiley_mfa_allowed');
  if(policies.some(p=>!['business_workflow_owner','business_workflow_insert'].includes(p.name)&&!safeMfa(p)))
    issues.push('Unexpected workflow receipt policy');
  for(const name of ['document_number_reservations','lead_setup_requests','filey_bootstrap_migrations'])
    if((catalog.policies??[]).some(p=>p.table===name&&!safeMfa(p))) issues.push(`Unexpected private ledger policy: ${name}`);
  return issues;
}
