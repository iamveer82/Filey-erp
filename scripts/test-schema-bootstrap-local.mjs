// Complete canonical installation against empty disposable PostgreSQL only.
// No deployment credentials, external service or customer database is used.
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bin=process.env.PGBIN||(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim());
const temp=mkdtempSync(join(tmpdir(),'filey-bootstrap-'));
const exe=name=>join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(name,args,input)=>execFileSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});
const runAsync=promisify(execFile);
const sql=file=>readFileSync(join(root,file),'utf8');
const server=createServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
await new Promise(resolve=>server.close(resolve));
const args=db=>['-h','127.0.0.1','-p',String(port),'-U','postgres','-d',db,'-X','-q','-v','ON_ERROR_STOP=1'];
const query=(db,text)=>run('psql',[...args(db),'-tA'],text).trim();
const prerequisite=sql('scripts/fixtures/supabase-prerequisites.sql');
const prerequisiteAgain=prerequisite.replace(/^create role[^\n]+\r?\n/gm,'');
const recurrenceOnly=process.argv.includes('--recurrence');
const genericDocumentOnly=process.argv.includes('--generic-document');
const removedMemberOnly=process.argv.includes('--removed-member');
async function testRemovedMembership() {
  const upgrade=sql('supabase/2026-10-07-removed-member-workspace-recovery.sql').replace(/^(?:begin;|commit;)\s*$/gmi,'');
  const authority=sql('supabase/2026-10-07-profile-workspace-authority.sql').replace(/^(?:begin;|commit;)\s*$/gmi,'');
  console.log(run('psql',args('postgres'),sql('scripts/fixtures/removed-member-workspace.sql')
    .replace('-- APPLY RECOVERY UPGRADE',()=>upgrade+'\n'+upgrade+'\n'+authority+'\n'+authority)).trim());
  run('psql',args('postgres'),`insert into auth.users(id,email,email_confirmed_at) values
    ('b7100000-0000-4000-8000-000000000001','race-owner@membership.invalid',now()),
    ('b7100000-0000-4000-8000-000000000002','race-member@membership.invalid',now());
    insert into org_members(org_id,user_id,role) select org_id,'b7100000-0000-4000-8000-000000000002','staff'
      from profiles where id='b7100000-0000-4000-8000-000000000001';`);
  const teamOrg=query('postgres',"select org_id from profiles where id='b7100000-0000-4000-8000-000000000001';");
  const ownOrg=query('postgres',"select org_id from profiles where id='b7100000-0000-4000-8000-000000000002';");
  const identity=id=>`set role authenticated;set request.jwt.claim.sub='${id}';set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';`;
  const switchSql=identity('b7100000-0000-4000-8000-000000000002')+`select public.filey_switch_workspace('${teamOrg}');`;
  const removeSql=identity('b7100000-0000-4000-8000-000000000001')+"delete from org_members where user_id='b7100000-0000-4000-8000-000000000002' and org_id=public.current_org();";
  const command=text=>runAsync(exe('psql'),[...args('postgres'),'-tA','-c',text],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
  const waitForLock=async name=>{
    const until=Date.now()+5000;
    while(Date.now()<until) {
      if(query('postgres',`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event='PgSleep');`)==='t') return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw new Error('Concurrent membership fixture did not acquire its lock: '+name);
  };
  // Both real lock orders: switch wins first; removal wins first. The bounded
  // database pause is only a synchronization barrier in the disposable fixture.
  const switching=command(`set application_name='filey-membership-switch';begin;${switchSql}select pg_sleep(2);commit;`);
  await waitForLock('filey-membership-switch');
  await Promise.all([switching,command(removeSql)]);
  assert.equal(query('postgres',"select org_id from profiles where id='b7100000-0000-4000-8000-000000000002';"),ownOrg,
    'Switch overwrote personal recovery after removal');
  run('psql',args('postgres'),`insert into org_members(org_id,user_id,role) values('${teamOrg}','b7100000-0000-4000-8000-000000000002','staff');
    update profiles set org_id='${teamOrg}' where id='b7100000-0000-4000-8000-000000000002';`);
  const removing=command(`set application_name='filey-membership-remove';begin;${removeSql}select pg_sleep(2);commit;`);
  await waitForLock('filey-membership-remove');
  const denied=assert.rejects(command(switchSql),error=>/You are not a member of this workspace/.test(error.stderr?.toString()||''));
  await Promise.all([removing,denied]);
  assert.equal(query('postgres',"select org_id from profiles where id='b7100000-0000-4000-8000-000000000002';"),ownOrg,
    'Delayed switch restored the removed team workspace');
  const alternate='b7300000-0000-4000-8000-000000000001';
  run('psql',args('postgres'),`insert into organizations(id,name,owner_id,created_at) values('${alternate}','Concurrent alternate workspace','b7100000-0000-4000-8000-000000000002',now()+interval '1 day');
    insert into org_members(org_id,user_id,role) values('${alternate}','b7100000-0000-4000-8000-000000000002','owner');
    update profiles set org_id='${teamOrg}' where id='b7100000-0000-4000-8000-000000000002';`);
  const alternateSwitch=command(`set application_name='filey-membership-alternate';begin;${identity('b7100000-0000-4000-8000-000000000002')}
    select public.filey_switch_workspace('${alternate}');select pg_sleep(2);commit;`);
  await waitForLock('filey-membership-alternate');
  await Promise.all([alternateSwitch,command(sql('supabase/2026-10-07-removed-member-workspace-recovery.sql'))]);
  assert.equal(query('postgres',"select org_id from profiles where id='b7100000-0000-4000-8000-000000000002';"),alternate,
    'Historic profile backfill overwrote a concurrently selected valid workspace');
  run('psql',args('postgres'),"delete from auth.users where id::text like 'b7100000-%';");
  console.log('PASS: concurrent switch/removal in both lock orders keeps personal access; historic backfill preserves a concurrently selected valid workspace.');
}
async function testRecurrence() {
  run('psql',args('postgres'),sql('scripts/fixtures/recurrence-setup.sql'));
  console.log(run('psql',args('postgres'),sql('scripts/fixtures/recurrence-assertions.sql')).trim());
  const command=`set role authenticated;set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000001';
    set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
    select public.filey_generate_recurring_invoice(920001,(now() at time zone 'UTC')::date,(now() at time zone 'UTC')::date,
      ((now() at time zone 'UTC')::date+interval '1 month')::date,auth.uid(),public.current_org());`;
  const results=await Promise.all(Array.from({length:8},async()=>{
    const {stdout}=await runAsync(exe('psql'),[...args('postgres'),'-tA','-c',command],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
    return stdout.trim();
  }));
  assert.equal(results.filter(value=>value==='t').length,1,'Concurrent recurring cycle created more than once');
  assert.equal(results.filter(value=>value==='f').length,7,'Other concurrent callers did not recognize the committed cycle');
  console.log('PASS: 8 simultaneous callers generate one recurring draft and advance one cycle; seven report no work.');
  console.log(run('psql',args('postgres'),sql('scripts/fixtures/recurrence-after-parallel.sql')).trim());
}
const snapshotSql=`select jsonb_object_agg(table_name,rows order by table_name) from (
  select c.relname table_name,(xpath('/table/row/rows/text()',query_to_xml(format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) as rows from public.%I t',c.relname),false,true,'')))[1]::text rows
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') all_rows;`;
let started=false;
try {
  execFileSync(process.execPath,[join(root,'scripts/build-schema-bootstrap.mjs')],{cwd:root,stdio:'inherit',windowsHide:true});
  run('initdb',['-D',temp,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']);
  const socket=process.platform==='win32'?'':` -k "${temp}"`;
  run('pg_ctl',['-D',temp,'-l',join(temp,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -c wal_level=logical${socket}`,'-w','start']);
  started=true;
  run('psql',args('postgres'),prerequisite);
  run('psql',args('postgres'),"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('b0000000-0000-4000-8000-000000000003','existing@bootstrap.invalid',now(),'{\"full_name\":\"Existing Auth account\"}');");
  const installer=sql('supabase/schema.sql');
  run('psql',args('postgres'),installer);
  const catalog=JSON.parse(query('postgres',sql('supabase/verify-runtime-schema.sql')));
  const catalogPath=join(root,'output/bootstrap-catalog.json');
  mkdirSync(join(root,'output'),{recursive:true});
  writeFileSync(catalogPath,JSON.stringify({rows:[{catalog}]},null,2)+'\n');
  console.log('PASS: actual full installer runs from empty public schema.');
  console.log(run('psql',args('postgres'),sql('scripts/fixtures/bootstrap-workflows.sql')).trim());
  if(removedMemberOnly) {
    await testRemovedMembership();
  } else if(recurrenceOnly) {
    await testRecurrence();
  } else if(genericDocumentOnly) {
    console.log(run('psql',args('postgres'),sql('scripts/fixtures/generic-document-authority.sql')).trim());
  } else {
  await testRemovedMembership();
  const before=query('postgres',snapshotSql);
  run('psql',args('postgres'),installer);
  assert.equal(query('postgres',snapshotSql),before,'Repeated installer modified saved rows, ownership, workspace identity or balances');
  console.log('PASS: repeated full installation preserves every seeded public row, including alternate-workspace data and funded wallet.');
  const installedHash=query('postgres',"select source_sha256 from public.filey_bootstrap_migrations where name='stripe-billing.sql';");
  run('psql',args('postgres'),"update public.filey_bootstrap_migrations set source_sha256=repeat('0',64) where name='stripe-billing.sql';");
  assert.throws(()=>run('psql',args('postgres'),installer),error=>/rewriting installed history/.test(error.stderr?.toString()||''));
  run('psql',args('postgres'),`update public.filey_bootstrap_migrations set source_sha256='${installedHash}' where name='stripe-billing.sql';`);
  assert.equal(query('postgres',snapshotSql),before,'A changed migration receipt allowed partial canonical changes');
  console.log('PASS: installed source hash mismatch refuses silently changed historical migrations and leaves saved data intact.');
  const currentUpgradePaths=['2026-10-04-document-child-authority.sql','2026-10-04-tool-job-authority.sql','2026-10-04-atomic-document-save.sql','2026-10-04-workspace-device-authority.sql','2026-10-04-public-document-privacy.sql','2026-10-04-atomic-payroll.sql','2026-10-04-subscription-claim-serialization.sql','2026-10-04-document-number-authority.sql','2026-10-04-atomic-lead-setup.sql','2026-10-04-atomic-business-workflows.sql','2026-10-04-atomic-recurrence.sql','2026-10-04-stripe-invoice-total-parity.sql','2026-10-04-cloud-storage-privacy.sql','2026-10-04-scheduled-agent-privacy.sql','2026-10-04-ai-credit-test-promotion.sql','2026-10-04-ai-credit-checkout-resume.sql','2026-10-07-removed-member-workspace-recovery.sql','2026-10-07-profile-workspace-authority.sql'];
  for(const file of currentUpgradePaths) run('psql',args('postgres'),sql('supabase/'+file)+'\n'+sql('supabase/'+file));
  assert.equal(query('postgres',snapshotSql),before,'Repeated current upgrade changed seeded customer records');
  console.log('PASS: current explicit upgrades apply repeatably to the populated installed database without rewriting saved records.');
  run('psql',args('postgres'),"delete from public.profiles where id='b0000000-0000-4000-8000-000000000003';");
  const afterProfileDeletion=query('postgres',snapshotSql);
  run('psql',args('postgres'),installer);
  assert.equal(query('postgres',"select count(*) from public.profiles where id='b0000000-0000-4000-8000-000000000003';"),'0','Repeated installer resurrected a deliberately removed profile');
  assert.equal(query('postgres',snapshotSql),afterProfileDeletion,'Repeated installer changed data after a profile was deliberately removed');
  console.log('PASS: once-only existing Auth provisioning does not recreate a deliberately removed profile on repeat.');
  console.log(run('psql',args('postgres'),sql('scripts/fixtures/generic-document-authority.sql')).trim());
  run('psql',args('postgres'),sql('scripts/fixtures/document-number-setup.sql'));
  run('psql',args('postgres'),sql('supabase/2026-10-04-document-number-authority.sql'));
  const reserve=request=>`set role authenticated;
    set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000001';
    set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';
    select public.filey_reserve_document_number('invoice','INV-{0001}-{YY}',2026,'${request}',auth.uid(),public.current_org());`;
  const parallel=async requests=>Promise.all(requests.map(async request=>{
    const {stdout}=await runAsync(exe('psql'),[...args('postgres'),'-tA','-c',reserve(request)],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
    return stdout.trim();
  }));
  const requests=Array.from({length:8},(_,i)=>`b1000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  const numbers=await parallel(requests);
  assert.equal(new Set(numbers).size,8,'Concurrent independent requests collided');
  assert.deepEqual([...numbers].sort(),Array.from({length:8},(_,i)=>`INV-${String(i+43).padStart(4,'0')}-26`));
  assert.equal(query('postgres',reserve(requests[0])),numbers[0],'Identical replay changed a number');
  const unused=query('postgres',reserve('b1000000-0000-4000-8000-000000000009'));
  assert.equal(unused,'INV-0051-26','Unused reservations were recycled');
  const sameRequest='b1000000-0000-4000-8000-000000000010';
  assert.deepEqual(await parallel(Array(8).fill(sameRequest)),Array(8).fill('INV-0052-26'));
  assert.equal(query('postgres',`select count(*) from public.document_number_reservations where request_id='${sameRequest}';`),'1');
  console.log('PASS: 8 parallel distinct requests allocate 43–50 from historical 42; replay is stable; unused reservation remains consumed; 8 parallel identical requests create exactly one reservation.');
  console.log(run('psql',args('postgres'),sql('scripts/fixtures/document-number-assertions.sql')).trim());
  console.log(run('psql',args('postgres'),sql('scripts/fixtures/lead-setup-assertions.sql')).trim());
  const leadConcurrent=Array.from({length:8},(_,i)=>`FL-${'23456789'[i].repeat(5)}-ABCDE-FGHJK-LMNPQ`);
  const leadResults=await Promise.all(leadConcurrent.map(async code=>{
    const command=`set role service_role;set request.jwt.claims='{"role":"service_role"}';
      select public.filey_record_lead('b3000000-0000-4000-8000-000000000008','Parallel fixture','+971500000008',null,null,'app','fixture-ip','freedom','${code}',now()+interval '30 days');`;
    const {stdout}=await runAsync(exe('psql'),[...args('postgres'),'-tA','-c',command],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
    return JSON.parse(stdout.trim());
  }));
  assert(leadResults.every(row=>JSON.stringify(row)===JSON.stringify(leadResults[0])),'Concurrent lead replay did not return the same persisted snapshot');
  assert.equal(query('postgres',"select count(*) from public.lead_requests where name='Parallel fixture';"),'1');
  assert.equal(query('postgres',"select count(*) from public.vouchers where code like 'FL-%-ABCDE-FGHJK-LMNPQ';"),'1');
  assert.equal(query('postgres',"select count(*) from public.lead_coupons where name='Parallel fixture';"),'1');
  assert.equal(query('postgres',"select count(*) from public.notifications where kind='lead' and body like 'Parallel fixture%';"),'1');
  console.log('PASS: 8 simultaneous identical inquiry requests with different proposed vouchers commit exactly one lead/voucher/coupon/notification and return one persisted snapshot.');
  await testRecurrence();
  for(const db of ['bootstrap_rollback','bootstrap_legacy','bootstrap_partial_legacy']) {
    run('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres',db]);
    run('psql',args(db),prerequisiteAgain);
  }
  // Fail after all DDL/DML to prove the whole installer is one transaction.
  const failing=installer.replace(/commit;\s*-- END GENERATED FRESH BOOTSTRAP final privileges/,"select 1/0;\ncommit;\n-- END GENERATED FRESH BOOTSTRAP final privileges");
  assert.notEqual(failing,installer,'Failure injection did not reach final commit');
  assert.throws(()=>run('psql',args('bootstrap_rollback'),failing),error=>/division by zero/.test(error.stderr?.toString()||''));
  assert.equal(query('bootstrap_rollback',"select to_regclass('public.profiles') is null and to_regclass('public.filey_bootstrap_migrations') is null;"),'t');
  console.log('PASS: a final-stage failure rolls back every application object and historical upgrade receipt.');
  run('psql',args('bootstrap_legacy'),"create table public.profiles(id uuid primary key,email text); insert into public.profiles values('b0000000-0000-4000-8000-000000000001','preserve@bootstrap.invalid');");
  assert.throws(()=>run('psql',args('bootstrap_legacy'),installer),error=>/documented upgrade migrations/.test(error.stderr?.toString()||''));
  assert.equal(query('bootstrap_legacy',"select email from public.profiles;"),'preserve@bootstrap.invalid');
  assert.equal(query('bootstrap_legacy',"select to_regclass('public.filey_bootstrap_migrations') is null;"),'t');
  console.log('PASS: untracked legacy installation is refused before any customer data or bootstrap state is changed.');
  run('psql',args('bootstrap_partial_legacy'),"create table public.invoice_docs(id bigint,number text); insert into public.invoice_docs values(1,'PARTIAL-LEGACY-KEEP');");
  assert.throws(()=>run('psql',args('bootstrap_partial_legacy'),installer),error=>/documented upgrade migrations/.test(error.stderr?.toString()||''));
  assert.equal(query('bootstrap_partial_legacy',"select number from public.invoice_docs;"),'PARTIAL-LEGACY-KEEP');
  assert.equal(query('bootstrap_partial_legacy',"select to_regclass('public.profiles') is null and to_regclass('public.filey_bootstrap_migrations') is null;"),'t');
  console.log('PASS: an untracked partial legacy installation without profiles is also refused without changing saved invoices.');
  execFileSync(process.execPath,[join(root,'scripts/check-cloud-schema.mjs'),catalogPath],{cwd:root,stdio:'inherit',windowsHide:true});
  console.log('PASS: fresh catalog matches all current checked-out application RPC/column/RLS/Realtime requirements.');
  }
} catch(error) {
  console.error(error.stderr?.toString()||error.stack||error.message);
  process.exitCode=1;
} finally {
  if(started) run('pg_ctl',['-D',temp,'-m','immediate','-w','stop']);
  // This exact temporary cluster is the only recursive removal target.
  if(resolve(temp).startsWith(resolve(tmpdir())+sep)&&dirname(temp)===resolve(tmpdir())) rmSync(temp,{recursive:true,force:true});
}
