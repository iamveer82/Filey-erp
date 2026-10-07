// Real PostgreSQL, disposable cluster, no Supabase credentials or customer data.
// PGBIN may point to a PostgreSQL bin directory; pg_config is used on CI/Linux.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { featureFunctionSources, featureSchemaIssues } from './runtime-schema-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.env.PGBIN || (process.platform === 'win32'
  ? 'C:/Program Files/PostgreSQL/18/bin'
  : execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim());
const temp = mkdtempSync(join(tmpdir(), 'filey-rls-'));
const exe = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const run = (name, args, input) => execFileSync(exe(name), args, {
  input, encoding: 'utf8', stdio: name === 'pg_ctl' ? 'ignore' : ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
let started = false;
try {
  run('initdb', ['-D', temp, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  // Linux packages default to a system-owned socket directory. Keep this
  // disposable cluster's socket in its own writable directory instead.
  const socket = process.platform === 'win32' ? '' : ` -k "${temp}"`;
  run('pg_ctl', ['-D', temp, '-l', join(temp, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}${socket}`, '-w', 'start']);
  started = true;
  const sql = file => readFileSync(join(root, file), 'utf8');
  const payrollOnly = process.argv.includes('--payroll');
  const claimsOnly = process.argv.includes('--billing-claims');
  if (!payrollOnly && !claimsOnly) {
  const migration = sql('supabase/2026-09-12-shared-record-permissions.sql');
  const syncMigration = sql('supabase/2026-09-12-sync-conflict-protection.sql');
  const moduleMigration = sql('supabase/2026-09-12-module-access.sql');
  const output = run('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'],
    sql('scripts/fixtures/rls-setup.sql') + '\n' + migration + '\n' + migration + '\n' + syncMigration + '\n' + syncMigration + '\n' + sql('scripts/fixtures/rls-checks.sql') + '\n' + sql('scripts/fixtures/sync-checks.sql') + '\n' + sql('scripts/fixtures/module-checks.sql') + '\n' + moduleMigration + '\n' + moduleMigration + '\n' + sql('scripts/fixtures/module-assertions.sql'));
  console.log(output.trim());
  const stocktakeArgs = ['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'];
  const stocktakeMigration = sql('supabase/2026-10-03-stocktake-reliability.sql');
  console.log(run('psql', stocktakeArgs, sql('scripts/fixtures/stocktake-setup.sql')+'\n'
    +stocktakeMigration+'\n'+stocktakeMigration+'\n'+sql('scripts/fixtures/stocktake-assertions.sql')).trim());
  const stocktakeRaces = await Promise.all(Array.from({length:8},()=>
    promisify(execFile)(exe('psql'),[...stocktakeArgs,'-tAc',
      "set role authenticated; set test.uid='00000000-0000-0000-0000-000000000001'; select public.filey_record_stocktake(8001,12.5,10,'e0000000-0000-4000-8000-000000000099');"],
      {encoding:'utf8',windowsHide:true})));
  assert(stocktakeRaces.every(result=>result.stdout.trim()==='12.500'));
  assert.equal(run('psql',[...stocktakeArgs,'-tAc','select quantity from products where id=8001']).trim(),'12.500');
  assert.equal(run('psql',[...stocktakeArgs,'-tAc','select count(*) from stock_movements where product_id=8001']).trim(),'1');
  assert.equal(run('psql',[...stocktakeArgs,'-tAc','select count(*) from stocktake_requests']).trim(),'1');
  console.log('PASS: eight simultaneous retries of one stocktake commit exactly one quantity adjustment and movement.');
  // Later manifest fixtures assert their original exact row counts.
  run('psql', stocktakeArgs, 'delete from stock_movements where product_id=8001; delete from products where id in (8001,8002);');
  const customFieldsMigration = sql('supabase/2026-09-28-crm-custom-fields.sql');
  const crmArgs = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'];
  // Supabase supplies Storage separately from the app schema. Match the managed
  // table shapes in supabase-prerequisites.sql for the full catalog exporter;
  // Storage policy behavior is exercised in its own disposable database.
  run('psql', crmArgs, `create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,metadata jsonb default '{}',created_at timestamptz default now());
    alter table storage.objects enable row level security;`);
  // The earlier module fixture has only id/key/value. Reproduce the actual
  // legacy user/key constraint before checking its narrow packaging exception.
  run('psql', crmArgs, `alter table app_settings add column user_id uuid not null default '00000000-0000-0000-0000-000000000001';
    alter table app_settings add column org_id text not null default 'a';
    alter table app_settings alter column user_id set default auth.uid();
    alter table app_settings alter column org_id set default public.current_org();
    alter table app_settings add column sync_revision bigint not null default 1;
    create trigger sync_revision before insert or update on app_settings for each row execute function public.version_synced_record();
    alter table app_settings add constraint app_settings_user_id_key unique(user_id,key);
    alter table app_settings add constraint app_settings_user_id_key_key unique(user_id,key);
    drop policy fixture_org on app_settings;
    create policy fixture_org on app_settings for all to authenticated using(org_id=public.current_org()) with check(org_id=public.current_org());`);
  const packagingMigration = sql('supabase/2026-10-01-packaging-lists.sql');
  console.log(run('psql', crmArgs, packagingMigration + '\n' + packagingMigration + '\n' + sql('scripts/fixtures/packaging-assertions.sql')).trim());
  const lettersMigration = sql('supabase/2026-10-03-letters.sql');
  const richLetterMigration = sql('supabase/2026-10-06-letter-rich-document.sql');
  run('psql', crmArgs, 'create role service_role;');
  console.log(run('psql', crmArgs, lettersMigration + '\n' + lettersMigration + '\n' + richLetterMigration + '\n' + richLetterMigration + '\n'
    + sql('scripts/fixtures/letters-assertions.sql') + '\n' + sql('scripts/fixtures/letter-rich-assertions.sql') + '\n' + sql('scripts/fixtures/packaging-assertions.sql')).trim());
  // Emulate the already deployed production variant: the expected partial
  // indexes coexist with an older unconditional constraint/index. The checker
  // must fail before the repair, and the repair must preserve all stored values.
  const settingsBeforeRepair = run('psql', [...crmArgs, '-tAc', 'select jsonb_agg(to_jsonb(s) order by id) from app_settings s']).trim();
  run('psql', crmArgs, `alter table app_settings add constraint app_settings_user_id_key_key unique(user_id,key);
    create unique index app_settings_user_id_key on app_settings(user_id,key);
    create unique index fixture_legacy_settings_pair on app_settings(key,user_id);
    create unique index fixture_unrelated_settings_index on app_settings(id,key);`);
  const legacyCatalog = JSON.parse(run('psql', [...crmArgs, '-tA'], sql('supabase/verify-runtime-schema.sql')));
  assert.deepEqual(featureSchemaIssues(legacyCatalog, featureFunctionSources(lettersMigration, stocktakeMigration, richLetterMigration)).sort(), [
    'Unexpected global settings uniqueness: app_settings_user_id_key',
    'Unexpected global settings uniqueness: app_settings_user_id_key_key',
    'Unexpected global settings uniqueness: fixture_legacy_settings_pair',
  ]);
  const settingUniquenessMigration = sql('supabase/2026-10-03-document-setting-uniqueness.sql');
  console.log(run('psql', crmArgs, settingUniquenessMigration + '\n' + settingUniquenessMigration + '\n'
    + sql('scripts/fixtures/document-setting-uniqueness-assertions.sql') + '\n'
    + sql('scripts/fixtures/packaging-assertions.sql') + '\n' + sql('scripts/fixtures/letters-assertions.sql')).trim());
  // The autogenerated name can also be a standalone index instead of a
  // constraint. Exercise both known names together, including reversed keys.
  run('psql', crmArgs, `create unique index app_settings_user_id_key_key on app_settings(key,user_id);
    create unique index app_settings_user_id_key on app_settings(user_id,key);`);
  console.log(run('psql', crmArgs, settingUniquenessMigration + '\n' + settingUniquenessMigration + '\n'
    + sql('scripts/fixtures/document-setting-uniqueness-assertions.sql')).trim());
  assert.equal(run('psql', [...crmArgs, '-tAc', 'select jsonb_agg(to_jsonb(s) order by id) from app_settings s']).trim(), settingsBeforeRepair);
  console.log('PASS: production-named and renamed legacy uniqueness repaired repeatably without changing setting rows.');
  const featureCatalog = JSON.parse(run('psql', [...crmArgs, '-tA'], sql('supabase/verify-runtime-schema.sql')));
  assert.deepEqual(featureSchemaIssues(featureCatalog, featureFunctionSources(lettersMigration, stocktakeMigration, richLetterMigration)), []);
  console.log('PASS: runtime catalog verifies document indexes/module guards/formatting and stocktake grants/RLS/receipt contract.');
  run('psql', crmArgs, customFieldsMigration + '\n' + customFieldsMigration);
  assert.equal(run('psql', [...crmArgs, '-tAc', "select count(*) from information_schema.columns where table_schema='public' and table_name in ('crm_leads','crm_opportunities','crm_tasks','crm_notes','crm_activities') and column_name='custom_fields' and data_type='jsonb'"]).trim(), '5');
  run('psql', crmArgs, "update crm_tasks set custom_fields='{\"region\":\"North\"}' where id=1;\n" + customFieldsMigration);
  assert.equal(run('psql', [...crmArgs, '-tAc', "select custom_fields->>'region' from crm_tasks where id=1"]).trim(), 'North');
  console.log('PASS: CRM custom-field migration is additive, repeatable and preserves saved values.');
  console.log(run('psql', ['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'],
    sql('supabase/2026-09-22-batched-sync.sql')+'\n'+sql('supabase/2026-09-22-batched-sync.sql')+'\n'+sql('scripts/fixtures/sync-batch-checks.sql')).trim());
  const manifestMigration = sql('supabase/2026-09-20-sync-manifest.sql');
  console.log(run('psql', ['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'],
    manifestMigration+'\n'+manifestMigration+'\n'+sql('scripts/fixtures/manifest-assertions.sql')).trim());
  const expenseOutput = run('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'],
    sql('scripts/fixtures/expense-setup.sql') + '\n' + sql('supabase/2026-09-13-expense-entry.sql') + '\n' + sql('supabase/2026-09-13-expense-entry.sql') + '\n' + sql('scripts/fixtures/expense-assertions.sql'));
  console.log(expenseOutput.trim());
  run('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'basic_web']);
  const basicArgs = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'basic_web', '-X', '-q', '-v', 'ON_ERROR_STOP=1'];
  const basicMigration = sql('supabase/2026-09-19-basic-web-access.sql');
  console.log(run('psql', basicArgs, sql('scripts/fixtures/basic-web-setup.sql') + '\n'
    + sql('supabase/2026-09-19-ultra-cloud-access.sql') + '\n' + basicMigration + '\n'
    + basicMigration + '\n' + sql('scripts/fixtures/basic-web-assertions.sql')).trim());
  const races = await Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
    promisify(execFile)(exe('psql'), [...basicArgs, '-c',
      `set role authenticated; select set_config('test.uid','20000000-0000-0000-0000-000000000006',false); insert into invoice_docs(id) values(${700+i});`],
    { encoding: 'utf8', windowsHide: true })));
  assert.equal(races.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of races) if (result.status === 'rejected') assert.match(result.reason.stderr, /Basic plan limit reached/);
  assert.equal(run('psql', [...basicArgs, '-tAc', "select used from invoice_monthly_usage where org_id='10000000-0000-0000-0000-000000000006'"]).trim(), '5');
  console.log('PASS: eight concurrent creations compete for one slot; exactly one succeeds.');
  console.log('PASS: shared/targeted/private permissions, child rows, cross-tenant RPC and idempotent migration.');
  run('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','document_children']);
  const childArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','document_children','-X','-q','-v','ON_ERROR_STOP=1'];
  const childMigration=sql('supabase/2026-10-04-document-child-authority.sql');
  console.log(run('psql',childArgs,sql('scripts/fixtures/rls-setup.sql').replace(/^create role (authenticated|anon);\r?\n/gm,'')+'\n'
    +migration+'\n'+sql('scripts/fixtures/document-child-setup.sql')+'\n'+childMigration+'\n'+childMigration+'\n'
    +sql('scripts/fixtures/document-child-assertions.sql')).trim());
  const atomicDocumentMigration=sql('supabase/2026-10-04-atomic-document-save.sql');
  console.log(run('psql',childArgs,sql('scripts/fixtures/atomic-document-setup.sql')+'\n'
    +atomicDocumentMigration+'\n'+atomicDocumentMigration+'\n'+sql('scripts/fixtures/atomic-document-assertions.sql')).trim());
  run('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','public_document_privacy']);
  const publicArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','public_document_privacy','-X','-q','-v','ON_ERROR_STOP=1'];
  const legacyPublicDoc=sql('supabase/2026-06-17-doc-unification.sql').match(/create or replace function public\.get_shared_doc\(p_token uuid\)[\s\S]+?grant execute on function public\.get_shared_doc\(uuid\) to anon, authenticated;/)[0];
  const publicPrivacy=sql('supabase/2026-10-04-public-document-privacy.sql');
  console.log(run('psql',publicArgs,sql('scripts/fixtures/rls-setup.sql').replace(/^create role (authenticated|anon);\r?\n/gm,'')+'\n'
    +sql('scripts/fixtures/public-document-setup.sql')+'\n'+migration+'\n'+childMigration+'\n'
    +sql('supabase/customer-portal.sql')+'\n'+legacyPublicDoc+'\n'+sql('scripts/fixtures/public-document-baseline.sql')+'\n'
    +publicPrivacy+'\n'+publicPrivacy+'\n'+sql('scripts/fixtures/public-document-assertions.sql')).trim());
  run('createdb', ['-h','127.0.0.1','-p',String(port),'-U','postgres','device_limits']);
  const deviceArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','device_limits','-X','-q','-v','ON_ERROR_STOP=1'];
  const deviceMigration=sql('supabase/2026-09-28-cloud-device-limit.sql');
  console.log(run('psql',deviceArgs,sql('scripts/fixtures/team-setup.sql')+'\n'+sql('supabase/2026-07-08-org-devices.sql')+'\n'
    +"create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('session_id',coalesce(nullif(current_setting('test.session',true),''),'session-a')) $$;\n"
    +"create table auth.sessions(id text primary key,user_id uuid,created_at timestamptz);\n"
    +deviceMigration+'\n'+deviceMigration+'\n'+sql('scripts/fixtures/device-limit-assertions.sql')).trim());
  const deviceRaces=await Promise.all(Array.from({length:5},(_,i)=>promisify(execFile)(exe('psql'),[...deviceArgs,'-tAc',
    `set role authenticated; set test.uid='00000000-0000-0000-0000-000000000001'; select public.register_device('race-${i}')->>'ok';`],{encoding:'utf8',windowsHide:true})));
  assert.equal(deviceRaces.filter(result=>result.stdout.trim()==='true').length,1);
  console.log('PASS: concurrent device registrations cannot exceed 20 slots.');
  console.log(run('psql',basicArgs,sql('scripts/fixtures/billing-lifecycle-setup.sql').replace(/^create role service_role;\r?\n/m,'')+'\n'
    +sql('supabase/2026-09-19-billing-integrity.sql')+'\n'+sql('scripts/fixtures/billing-lifecycle-assertions.sql')).trim());
  const refundMigration=sql('supabase/2026-09-20-subscription-refunds.sql');
  console.log(run('psql',basicArgs,refundMigration+'\n'+refundMigration+'\n'+sql('scripts/fixtures/subscription-refund-assertions.sql')).trim());
  const refundRaces = await Promise.all(Array.from({length:8},()=>
    promisify(execFile)(exe('psql'),[...basicArgs,'-tAc',
      "set role service_role; update subscription_refund_requests set status='processing' where payment_id='pay_test' and status='requested' returning id;"],
      {encoding:'utf8',windowsHide:true})));
  assert.equal(refundRaces.filter(r=>r.stdout.includes('90000000-0000-4000-8000-000000000001')).length,1);
  console.log('PASS: exactly one of eight simultaneous merchant approvals can claim a refund.');
  run('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'team_acceptance']);
  const teamArgs = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'team_acceptance', '-X', '-q', '-v', 'ON_ERROR_STOP=1'];
  const teamMigration = sql('supabase/2026-09-20-team-workspaces.sql');
  console.log(run('psql', teamArgs, sql('scripts/fixtures/team-setup.sql') + '\n' + migration + '\n' + moduleMigration + '\n'
    + teamMigration + '\n' + teamMigration + '\n' + sql('scripts/fixtures/team-assertions.sql')).trim());
  const avatarMigration = sql('supabase/2026-09-28-member-avatars.sql');
  console.log(run('psql', teamArgs, avatarMigration + '\n' + avatarMigration + '\n' + sql('scripts/fixtures/member-avatar-assertions.sql')).trim());
  const avatarChoicesMigration = sql('supabase/2026-09-30-avatar-choices.sql');
  console.log(run('psql', teamArgs, avatarChoicesMigration + '\n' + avatarChoicesMigration + '\n' + sql('scripts/fixtures/avatar-choice-assertions.sql')).trim());
  const avatarBefore = run('psql', [...teamArgs, '-tAc', "select jsonb_agg(jsonb_build_array(id,avatar) order by id) from org_members"]).trim();
  run('psql', teamArgs, avatarChoicesMigration);
  assert.equal(run('psql', [...teamArgs, '-tAc', "select jsonb_agg(jsonb_build_array(id,avatar) order by id) from org_members"]).trim(), avatarBefore);
  console.log('PASS: avatar-choice migration is repeatable and does not rewrite saved presets.');
  const mascotMigration = sql('supabase/2026-10-07-mascot-avatars.sql');
  run('psql', teamArgs, mascotMigration + '\n' + mascotMigration);
  assert.equal(run('psql', [...teamArgs, '-tAc', "select jsonb_agg(jsonb_build_array(id,avatar) order by id) from org_members"]).trim(), avatarBefore);
  console.log(run('psql', teamArgs, sql('scripts/fixtures/mascot-avatar-assertions.sql') + '\n' + sql('scripts/fixtures/avatar-choice-assertions.sql')).trim());
  console.log(run('psql',teamArgs,sql('supabase/2026-09-20-profile-insert-scope.sql')+'\n'
    +sql('scripts/fixtures/profile-scope-assertions.sql')).trim());
  const rateMigration = sql('supabase/2026-09-20-edge-rate-limits.sql');
  console.log(run('psql',teamArgs,rateMigration+'\n'+rateMigration+'\n'+sql('scripts/fixtures/rate-limit-assertions.sql')).trim());
  const teamCodesMigration = sql('supabase/2026-09-28-team-codes.sql');
  console.log(run('psql',teamArgs,teamCodesMigration+'\n'+teamCodesMigration+'\n'+sql('scripts/fixtures/team-code-assertions.sql')).trim());
  run('psql',teamArgs,"insert into auth.users values('00000000-0000-0000-0000-000000000006','race@example.invalid',now()); insert into profiles(id,org_id,name) values('00000000-0000-0000-0000-000000000006','default','Race');");
  const joinCode = run('psql',[...teamArgs,'-tAc',"select code from team_invite_codes where user_id='00000000-0000-0000-0000-000000000001'"]).trim();
  assert.match(joinCode,/^[A-Z0-9]{6}$/);
  const joinRaces = await Promise.all(Array.from({length:5},()=>promisify(execFile)(exe('psql'),[...teamArgs,'-tAc',
    `set role authenticated; set test.uid='00000000-0000-0000-0000-000000000006'; select filey_request_team_join('${joinCode}')->>'id';`],{encoding:'utf8',windowsHide:true})));
  const requestId=joinRaces[0].stdout.trim();
  assert.match(requestId,/^[0-9a-f-]{36}$/);
  assert(joinRaces.every(result=>result.stdout.trim()===requestId),'Concurrent requests must reuse one pending request');
  const approvalRaces = await Promise.allSettled(Array.from({length:5},()=>promisify(execFile)(exe('psql'),[...teamArgs,'-tAc',
    `set role authenticated; set test.uid='00000000-0000-0000-0000-000000000001'; select filey_review_team_join('${requestId}','10000000-0000-0000-0000-000000000001',true);`],{encoding:'utf8',windowsHide:true})));
  assert.equal(approvalRaces.filter(result=>result.status==='fulfilled').length,1);
  for(const result of approvalRaces) if(result.status==='rejected') assert.match(result.reason.stderr,/no longer waiting for approval/);
  console.log('PASS: concurrent code requests reuse one request and concurrent approvals grant membership exactly once.');
  run('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','team_media']);
  const mediaArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','team_media','-X','-q','-v','ON_ERROR_STOP=1'];
  const mediaMigration=sql('supabase/2026-09-28-team-attachments.sql');
  console.log(run('psql',mediaArgs,sql('scripts/fixtures/team-setup.sql')+'\n'+migration+'\n'+moduleMigration+'\n'+teamMigration+'\n'
    +sql('scripts/fixtures/team-media-setup.sql')+'\n'+mediaMigration+'\n'+mediaMigration+'\n'+sql('scripts/fixtures/team-media-assertions.sql')).trim());
  run('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','team_read_access']);
  const membershipArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','team_read_access','-X','-q','-v','ON_ERROR_STOP=1'];
  const membershipReadMigration=sql('supabase/2026-10-03-workspace-membership-read-integrity.sql');
  console.log(run('psql',membershipArgs,sql('scripts/fixtures/team-membership-read-setup.sql')+'\n'
    +membershipReadMigration+'\n'+membershipReadMigration+'\n'+sql('scripts/fixtures/team-membership-read-assertions.sql')).trim());
  run('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','workspace_device_authority']);
  const registryArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','workspace_device_authority','-X','-q','-v','ON_ERROR_STOP=1'];
  const registryMigration=sql('supabase/2026-10-04-workspace-device-authority.sql');
  console.log(run('psql',registryArgs,sql('scripts/fixtures/team-setup.sql')+'\n'+sql('supabase/2026-07-08-org-devices.sql')+'\n'
    +"create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('session_id','session-a') $$; create table auth.sessions(id text primary key,user_id uuid,created_at timestamptz);\n"
    +deviceMigration+'\n'
    +sql('scripts/fixtures/workspace-device-setup.sql')+'\n'+registryMigration+'\n'+registryMigration+'\n'
    +sql('scripts/fixtures/workspace-device-assertions.sql')).trim());
  run('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','canonical_invitation']);
  const canonicalArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','canonical_invitation','-X','-q','-v','ON_ERROR_STOP=1'];
  const canonicalSchema=sql('supabase/schema.sql');
  const canonicalInviteSql=canonicalSchema.match(/alter table public\.invitations add column if not exists expires_at[\s\S]+?;/)[0]+'\n'
    +canonicalSchema.match(/create or replace function public\.my_email\(\)[\s\S]+?grant execute on function public\.my_email\(\) to authenticated;/)[0]+'\n'
    +canonicalSchema.match(/create or replace function public\.accept_invitation\(invite uuid\)[\s\S]+?grant execute on function public\.accept_invitation\(uuid\) to authenticated;/)[0];
  console.log(run('psql',canonicalArgs,sql('scripts/fixtures/team-setup.sql')+'\n'+canonicalInviteSql+'\n'
    +canonicalInviteSql+'\n'+sql('scripts/fixtures/canonical-invitation-assertions.sql')).trim());
  run('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','tool_job_authority']);
  const toolArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','tool_job_authority','-X','-q','-v','ON_ERROR_STOP=1'];
  const toolAuthority=sql('supabase/2026-10-04-tool-job-authority.sql');
  console.log(run('psql',toolArgs,sql('scripts/fixtures/tool-job-authority-setup.sql')+'\n'+rateMigration+'\n'
    +toolAuthority+'\n'+toolAuthority+'\n'+sql('scripts/fixtures/tool-job-authority-assertions.sql')).trim());
  const limitRace = await Promise.all(Array.from({length:12}, () =>
    promisify(execFile)(exe('psql'), [...teamArgs,'-tAc',
      "set role service_role; select public.filey_take_rate_limit('concurrent-account','race',3,3600);"],
      {encoding:'utf8',windowsHide:true})));
  assert.equal(limitRace.filter(result => result.stdout.trim()==='t').length,3);
  console.log('PASS: exactly three of twelve concurrent requests reserve the three available slots.');
  run('createdb', ['-h','127.0.0.1','-p',String(port),'-U','postgres','ai_credits']);
  const creditArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','ai_credits','-X','-q','-v','ON_ERROR_STOP=1'];
  const creditMigration=sql('supabase/2026-09-20-ai-credits.sql')+'\n'+sql('supabase/2026-09-21-ai-credit-topup-fee.sql');
  console.log(run('psql',creditArgs,"create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$; grant usage on schema public,auth to authenticated,service_role;\n"
    +creditMigration+'\n'+creditMigration+'\n'+sql('scripts/fixtures/ai-credit-assertions.sql')).trim());
  // Existing pre-video installs have the wallet table, but no expires_at.
  // Dropping the new column in this disposable DB reproduces that upgrade.
  run('psql', creditArgs, 'alter table ai_credit_requests drop column expires_at cascade;\n' + creditMigration);
  assert.equal(run('psql', [...creditArgs, '-tAc', "select count(*) from information_schema.columns where table_name='ai_credit_requests' and column_name='expires_at'"]).trim(), '1');
  console.log('PASS: older wallet schema upgrades before the expiry index is created.');
  const creditRaces=await Promise.allSettled(Array.from({length:8},(_,i)=>promisify(execFile)(exe('psql'),[...creditArgs,'-tAc',
    `set role service_role; select filey_ai_wallet('reserve','30000000-0000-4000-8000-000000000003','{"request_id":"70000000-0000-4000-8000-${String(i+1).padStart(12,'0')}","run_id":"80000000-0000-4000-8000-${String(i+1).padStart(12,'0')}","model":"fixture/model","amount_micros":1000000,"markup_bps":2000}');`],{encoding:'utf8',windowsHide:true})));
  assert.equal(creditRaces.filter(r=>r.status==='fulfilled').length,5);
  for(const r of creditRaces) if(r.status==='rejected') assert.match(r.reason.stderr,/Not enough available AI credits/);
  assert.equal(run('psql',[...creditArgs,'-tAc',"select balance_micros-reserved_micros from ai_credit_accounts where user_id='30000000-0000-4000-8000-000000000003'"]).trim(),'0');
  console.log('PASS: five dollars funds exactly five of eight concurrent one-dollar reservations.');
  const videoMigration=sql('supabase/2026-09-21-ai-video.sql');
  console.log(run('psql',creditArgs,videoMigration+'\n'+videoMigration+'\n'+sql('scripts/fixtures/ai-video-assertions.sql')).trim());
  const videoRaces=await Promise.all(Array.from({length:8},()=>promisify(execFile)(exe('psql'),[...creditArgs,'-tAc',
    `set role service_role; select filey_ai_video('start','31000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000009','{"charge_micros":1250000}')->>'claimed';`],{encoding:'utf8',windowsHide:true})));
  assert.equal(videoRaces.filter(r=>r.stdout.trim()==='true').length,1);
  assert.equal(run('psql',[...creditArgs,'-tAc',"select reserved_micros from ai_credit_accounts where user_id='31000000-0000-4000-8000-000000000001'"]).trim(),'1250000');
  console.log('PASS: eight concurrent Generate clicks reserve and claim exactly one video.');
  const paymentSafetyMigration=sql('supabase/2026-10-03-ai-credit-payment-safety.sql');
  console.log(run('psql',creditArgs,paymentSafetyMigration+'\n'+paymentSafetyMigration+'\n'
    +sql('scripts/fixtures/ai-credit-payment-safety-assertions.sql')).trim());
  await Promise.all(Array.from({length:8},(_,i)=>promisify(execFile)(exe('psql'),[...creditArgs,'-tAc',
    `set role service_role; select filey_ai_wallet('${i%2 ? 'resolve_dispute' : 'dispute'}','30000000-0000-4000-8000-000000000004','{"order_id":"40000000-0000-4000-8000-000000000004","event_type":"${i%2 ? 'dispute.won' : 'dispute.opened'}","event_at":"2026-10-03T15:00:00Z"}');`],{encoding:'utf8',windowsHide:true})));
  assert.equal(run('psql',[...creditArgs,'-tAc',"select disputed from ai_credit_orders where id='40000000-0000-4000-8000-000000000004'"]).trim(),'t');
  console.log('PASS: blocking wins eight concurrent equal-time dispute deliveries.');
  const refundedPaymentRaces=await Promise.allSettled(Array.from({length:16},(_,i)=>promisify(execFile)(exe('psql'),[...creditArgs,'-tAc', i%2
    ? `set role service_role; select filey_ai_wallet('reserve','30000000-0000-4000-8000-000000000007','{"request_id":"70000000-0000-4000-8000-${String(i+101).padStart(12,'0')}","run_id":"80000000-0000-4000-8000-${String(i+101).padStart(12,'0')}","amount_micros":1,"model":"filey-ai","markup_bps":0}');`
    : `set role service_role; select filey_ai_wallet('reconcile_payment','30000000-0000-4000-8000-000000000007','{"order_id":"40000000-0000-4000-8000-000000000007","payment_id":"pay_atomic_race","paid_cents":550,"refunds":[{"refund_id":"ref_atomic_race","refund_cents":550}]}');`],{encoding:'utf8',windowsHide:true})));
  assert.equal(refundedPaymentRaces.filter(r=>r.status==='fulfilled').length,8);
  for(const r of refundedPaymentRaces) if(r.status==='rejected') assert.match(r.reason.stderr,/Not enough available AI credits/);
  assert.equal(run('psql',[...creditArgs,'-tAc',"select balance_micros+reserved_micros from ai_credit_accounts where user_id='30000000-0000-4000-8000-000000000007'"]).trim(),'0');
  assert.equal(run('psql',[...creditArgs,'-tAc',"select count(*) from ai_credit_ledger where user_id='30000000-0000-4000-8000-000000000007'"]).trim(),'2');
  console.log('PASS: refunded payment retries cannot fund any of eight concurrent AI reservations.');
  run('createdb', ['-h','127.0.0.1','-p',String(port),'-U','postgres','workspace_sync']);
  const workspaceArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','workspace_sync','-X','-q','-v','ON_ERROR_STOP=1'];
  const recoveryMigration=sql('supabase/2026-09-25-workspace-sync-recovery.sql');
  console.log(run('psql',workspaceArgs,sql('scripts/fixtures/workspace-sync-setup.sql')+'\n'+migration+'\n'+syncMigration+'\n'
    +recoveryMigration+'\n'+recoveryMigration+'\n'+sql('scripts/fixtures/workspace-sync-assertions.sql')).trim());
  }
  if (payrollOnly || claimsOnly) run('psql', ['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'],
    'create role authenticated; create role anon; create role service_role;');
  if (!claimsOnly) {
  run('createdb', ['-h','127.0.0.1','-p',String(port),'-U','postgres','payroll_atomic']);
  const payrollArgs = ['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','payroll_atomic','-X','-q','-v','ON_ERROR_STOP=1'];
  const payrollMigration = sql('supabase/2026-10-04-atomic-payroll.sql');
  console.log(run('psql', payrollArgs, sql('scripts/fixtures/payroll-setup.sql')+'\n'
    +payrollMigration+'\n'+payrollMigration+'\n'+sql('scripts/fixtures/payroll-assertions.sql')).trim());
  const payrollRaces = await Promise.allSettled(Array.from({length:8},()=>
    promisify(execFile)(exe('psql'), [...payrollArgs,'-tAc',
      "set role authenticated; set test.uid='00000000-0000-4000-8000-000000000001'; select filey_run_payroll(1,'2026-10',10,0,0,null,'2026-10-31','a',auth.uid());"],
      {encoding:'utf8',windowsHide:true})));
  assert.equal(payrollRaces.filter(result=>result.status==='fulfilled').length,1);
  for (const result of payrollRaces) if(result.status==='rejected') assert.match(result.reason.stderr,/already recorded for this employee and period/);
  assert.equal(run('psql',[...payrollArgs,'-tAc',"select count(*) from payroll where employee_id=1 and period='2026-10'"]).trim(),'1');
  assert.equal(run('psql',[...payrollArgs,'-tAc','select count(*) from transactions']).trim(),'4');
  assert.equal(run('psql',[...payrollArgs,'-tAc',"select balance from accounts where account_type='expense'"]).trim(),'110.00');
  assert.equal(run('psql',[...payrollArgs,'-tAc',"select balance from accounts where account_type='asset'"]).trim(),'-110.00');
  console.log('PASS: eight concurrent payroll runs commit one payslip and one balanced posting.');
  }
  if (!payrollOnly) {
    run('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','subscription_claims']);
    const claimsArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','subscription_claims','-X','-q','-v','ON_ERROR_STOP=1'];
    run('psql',claimsArgs,sql('scripts/fixtures/subscription-claims-setup.sql')+'\n'+sql('supabase/2026-09-19-billing-integrity.sql'));
    const seedClaims = `update organizations set plan='free',dodo_subscription_id=null,dodo_customer_id=null;
      delete from pending_entitlements;
      insert into pending_entitlements(email,kind,dodo_subscription_id,dodo_customer_id,plan_status,current_period_end) values
       ('owner@example.invalid','cloud','sub-owner','customer-owner','active',now()+interval '1 month'),
       ('admin@example.invalid','cloud','sub-admin','customer-admin','active',now()+interval '1 month');`;
    const claimRace = () => Promise.all([1,2].map(id=>promisify(execFile)(exe('psql'),[...claimsArgs,'-tAc',
      `set role authenticated; set test.uid='00000000-0000-4000-8000-${String(id).padStart(12,'0')}'; select filey_claim_entitlements()->>'cloud';`],{encoding:'utf8',windowsHide:true})));
    run('psql',claimsArgs,seedClaims);
    const oldClaims = await claimRace();
    assert(oldClaims.every(result=>result.stdout.trim()==='1'));
    assert.equal(run('psql',[...claimsArgs,'-tAc','select count(*) from pending_entitlements where claimed_at is not null']).trim(),'2');
    console.log('PASS: baseline reproduces two paid claims consumed for one workspace.');
    const claimMigration=sql('supabase/2026-10-04-subscription-claim-serialization.sql');
    run('psql',claimsArgs,claimMigration+'\n'+claimMigration+'\n'+seedClaims);
    const fixedClaims = await claimRace();
    assert.deepEqual(fixedClaims.map(result=>result.stdout.trim()).sort(),['0','1']);
    assert.equal(run('psql',[...claimsArgs,'-tAc','select count(*) from pending_entitlements where claimed_at is not null']).trim(),'1');
    assert.equal(run('psql',[...claimsArgs,'-tAc',"select count(*) from pending_entitlements e join organizations o on o.dodo_subscription_id=e.dodo_subscription_id and o.dodo_customer_id=e.dodo_customer_id where e.claimed_at is not null"]).trim(),'1');
    assert.equal(run('psql',[...claimsArgs,'-tAc',"select has_function_privilege('anon','filey_claim_entitlements()','execute')"]).trim(),'f');
    console.log('PASS: concurrent paid claims retain the losing entitlement and preserve the winning subscription/customer binding.');
  }
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  try { console.error(readFileSync(join(temp, 'server.log'), 'utf8')); } catch { /* startup may not have created it */ }
  process.exitCode = 1;
} finally {
  if (started) run('pg_ctl', ['-D', temp, '-m', 'immediate', '-w', 'stop']);
  // Delete only the fresh cluster created above, never a user-supplied DB path.
  if (resolve(temp).startsWith(resolve(tmpdir()) + sep) && dirname(temp) === resolve(tmpdir()))
    rmSync(temp, { recursive: true, force: true });
}
