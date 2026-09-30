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
  const migration = sql('supabase/2026-09-12-shared-record-permissions.sql');
  const syncMigration = sql('supabase/2026-09-12-sync-conflict-protection.sql');
  const moduleMigration = sql('supabase/2026-09-12-module-access.sql');
  const output = run('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'],
    sql('scripts/fixtures/rls-setup.sql') + '\n' + migration + '\n' + migration + '\n' + syncMigration + '\n' + syncMigration + '\n' + sql('scripts/fixtures/rls-checks.sql') + '\n' + sql('scripts/fixtures/sync-checks.sql') + '\n' + sql('scripts/fixtures/module-checks.sql') + '\n' + moduleMigration + '\n' + moduleMigration + '\n' + sql('scripts/fixtures/module-assertions.sql'));
  console.log(output.trim());
  const customFieldsMigration = sql('supabase/2026-09-28-crm-custom-fields.sql');
  const crmArgs = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'];
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
  console.log(run('psql',basicArgs,sql('scripts/fixtures/billing-lifecycle-setup.sql')+'\n'
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
  run('createdb', ['-h','127.0.0.1','-p',String(port),'-U','postgres','workspace_sync']);
  const workspaceArgs=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','workspace_sync','-X','-q','-v','ON_ERROR_STOP=1'];
  const recoveryMigration=sql('supabase/2026-09-25-workspace-sync-recovery.sql');
  console.log(run('psql',workspaceArgs,sql('scripts/fixtures/workspace-sync-setup.sql')+'\n'+migration+'\n'+syncMigration+'\n'
    +recoveryMigration+'\n'+recoveryMigration+'\n'+sql('scripts/fixtures/workspace-sync-assertions.sql')).trim());
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
