// Actual canonical schema, disposable PostgreSQL, no customer/provider access.
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {docTotals,splitItemMeta} from '../supabase/functions/_shared/docItems.ts';
import {applyRoundOff} from '../supabase/functions/_shared/money.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bin=process.env.PGBIN||(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim());
const temp=mkdtempSync(join(tmpdir(),'filey-business-'));
const exe=name=>join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(name,args,input)=>execFileSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});
const sql=file=>readFileSync(join(root,file),'utf8');
const server=createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port; await new Promise(resolve=>server.close(resolve));
const args=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'];
const query=text=>run('psql',[...args,'-tA'],text).trim();
const actor='c0000000-0000-4000-8000-000000000001';
const asActor=`set role authenticated; set request.jwt.claim.sub='${actor}'; set request.jwt.claims='{"role":"authenticated","aal":"aal1"}'; `;
let started=false;
try {
  run('initdb',['-D',temp,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']);
  const socket=process.platform==='win32'?'':` -k "${temp}"`;
  run('pg_ctl',['-D',temp,'-l',join(temp,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -c wal_level=logical${socket}`,'-w','start']); started=true;
  run('psql',args,sql('scripts/fixtures/supabase-prerequisites.sql')+'\n'+sql('supabase/schema.sql'));
  const saveAuthority="select jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig) from pg_proc where oid='public.filey_save_document(text,jsonb,jsonb,bigint)'::regprocedure;";
  const beforeSaveAuthority=query(saveAuthority);
  const saveUpgrade=sql('supabase/2026-10-07-document-save-performance.sql');
  run('psql',args,saveUpgrade+'\n'+saveUpgrade);
  assert.equal(query(saveAuthority),beforeSaveAuthority,'Document save upgrade changed its owner, ACL, invoker authority or search path');
  const auditAuthority="select jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig,'triggers',(select jsonb_agg(jsonb_build_object('oid',oid,'definition',pg_get_triggerdef(oid)) order by oid) from pg_trigger where tgfoid=p.oid)) from pg_proc p where oid='public.log_audit()'::regprocedure;";
  const beforeAuditAuthority=query(auditAuthority);
  const auditUpgrade=sql('supabase/2026-10-08-audit-artwork-metadata.sql');
  run('psql',args,auditUpgrade+'\n'+auditUpgrade);
  assert.equal(query(auditAuthority),beforeAuditAuthority,'Audit upgrade changed owner, ACL, definer authority, search path or triggers');
  const migration=sql('supabase/2026-10-04-atomic-business-workflows.sql');
  run('psql',args,migration+'\n'+migration);
  // A colliding privileged role is a migration failure, never an RLS bypass.
  query('alter role filey_workflow_executor bypassrls;');
  assert.throws(()=>run('psql',args,migration), error=>String(error.stderr || '').includes('workflow execution role must be nonlogin/nonbypass'));
  query('alter role filey_workflow_executor nobypassrls;');
  query('grant filey_workflow_executor to anon;');
  assert.throws(()=>run('psql',args,migration), error=>String(error.stderr || '').includes('workflow execution role must be nonlogin/nonbypass'));
  query('revoke filey_workflow_executor from anon;');
  run('psql',args,migration);
  console.log('PASS: migration refuses an existing RLS-bypass executor or client role membership and remains repeatable after repair.');
  query(`create role workflow_fixture_installer nologin nosuperuser nobypassrls createrole inherit;
    grant postgres to workflow_fixture_installer;
    grant authenticated to workflow_fixture_installer with admin option;
    grant filey_workflow_executor to workflow_fixture_installer with admin option;`);
  run('psql',args,'set role workflow_fixture_installer;\n'+migration);
  assert.equal(query("select has_schema_privilege('filey_workflow_executor','public','CREATE');"),'f');
  console.log('PASS: a nonsuperuser table-owning installer can assign the executor functions, and executor schema CREATE is revoked before commit.');
  console.log(run('psql',args,sql('scripts/fixtures/business-workflow-assertions.sql')).trim());
  console.log(run('psql',args,sql('scripts/fixtures/document-save-performance.sql')).trim());
  console.log(run('psql',args,sql('scripts/fixtures/audit-artwork-metadata.sql')).trim());
  console.log(run('psql',args,sql('scripts/fixtures/business-advance-ownership.sql')).trim());
  // Reproduce the actual pre-fix gap only inside a rolled-back synthetic DB
  // transaction: all current authority gates remain, except the new net-pool
  // guard. A matching author used to make borrowed credit look attributable.
  const creditFunction=migration.match(/create or replace function public\.filey_workflow_credit_available[\s\S]+?end \$\$;/)?.[0];
  assert(creditFunction);
  const baselineCredit=creditFunction.replace(/  if exists\(select 1 from public\.advances where org_id=v_org and party_type=p_type and party_id=p_party\r?\n    group by user_id having sum\(amount\)<-0\.005\) then return false; end if;/,'');
  assert.notEqual(baselineCredit,creditFunction);
  const legacyFixture=sql('scripts/fixtures/business-legacy-credit-pools.sql');
  run('psql',args,"begin;\n"+baselineCredit+"\nset filey.fixture.credit_baseline='on';\n"+legacyFixture+'\nrollback;');
  console.log('BASELINE REPRODUCED: without the private negative-pool guard, matching-author legacy borrowing lets the original depositor allocate 80 again and leaves -40 credit. Rolled back.');
  console.log(run('psql',args,legacyFixture).trim());
  const beforeAr=Number(query("select balance from accounts where name='Accounts Receivable';"));
  const race=`${asActor} select public.filey_business_workflow('invoice','payment-add','{"id":910001,"amount":5,"paid_at":"2026-10-04","rates":{}}','c0000000-0000-4000-8000-000000000090',auth.uid(),public.current_org());`;
  const outcomes=await Promise.all(Array.from({length:8},()=>promisify(execFile)(exe('psql'),[...args,'-tA','-c',race],{encoding:'utf8',windowsHide:true}).catch(error=>{throw new Error(error.stderr?.toString()||error.message);} )));
  assert(outcomes.every(outcome=>outcome.stdout.trim()===outcomes[0].stdout.trim()));
  assert.equal(query('select count(*) from invoice_payments where invoice_id=910001;'),'1');
  assert.equal(query('select quantity from products where id=910001;'),'98.000');
  assert.equal(Number(query("select balance from accounts where name='Accounts Receivable';")),beforeAr-5);
  console.log('PASS: eight simultaneous retries create one receipt, balanced payment postings, and leave invoice stock unchanged.');
  const cases=[
    {tax_rate:5,discount:1.01,items:[{qty:3,unit_price:7.13,tax_category:'S'},{qty:2,unit_price:1.02,tax_category:'Z'},{qty:1,unit_price:2.99,tax_category:'E'}]},
    {tax_rate:5,discount:3,items:[{qty:1,unit_price:10,custom:{__calc_mode:'manual',__manual_amount:'22.345',__disc_pct:'12.5',__tax_pct:'7.5'}},{qty:4,unit_price:1.15,custom:{__calc_mode:'formula',__formula_a:'Liters',Liters:'12.5 L'}}]},
    {tax_rate:5,discount:0,round_off:true,unit_price_formula:{a:'Liters'},items:[{qty:1,unit_price:1.15,custom:{Liters:'12.5'}},{qty:1,unit_price:2,custom:{Liters:'7.7',__disc_pct:'5'}}]},
  ];
  for (const fixture of cases) {
    const {items,...doc}=fixture;
    const expected=applyRoundOff(docTotals(items.map(item=>({...item,description:'',...splitItemMeta(item.custom)})),doc.discount,doc.tax_rate,doc.unit_price_formula),doc.round_off);
    const actual=JSON.parse(query(`select filey_workflow_totals('${JSON.stringify(doc)}'::jsonb,'${JSON.stringify(items)}'::jsonb);`));
    assert.equal(actual.total,expected.total); assert.equal(actual.tax,expected.tax);
  }
  console.log('PASS: SQL tax groups, cent discount allocation, manual/formula rows, per-line discounts/tax and whole-unit round-off match the shared preview/PDF calculator.');
} catch(error) {console.error(error.stderr?.toString()||error.stack||error.message);process.exitCode=1;}
finally {
  if(started) run('pg_ctl',['-D',temp,'-m','immediate','-w','stop']);
  if(resolve(temp).startsWith(resolve(tmpdir())+sep)&&dirname(temp)===resolve(tmpdir())) rmSync(temp,{recursive:true,force:true});
}
