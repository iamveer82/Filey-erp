// Disposable PostgreSQL, synthetic identities; no credentials or provider calls.
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bin=process.env.PGBIN||(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim());
const temp=mkdtempSync(join(tmpdir(),'filey-coin-promotion-'));
const exe=name=>join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(name,args,input)=>execFileSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});
const sql=file=>readFileSync(join(root,file),'utf8');
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const args=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'];
const query=text=>run('psql',[...args,'-tA'],text).trim();
let started=false;
try {
  run('initdb',['-D',temp,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']);
  const socket=process.platform==='win32'?'':` -k "${temp}"`;
  run('pg_ctl',['-D',temp,'-l',join(temp,'server.log'),'-o',`-h 127.0.0.1 -p ${port}${socket}`,'-w','start']);started=true;
  run('psql',args,"create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth,public to authenticated,service_role;");
  run('psql',args,sql('supabase/2026-09-20-ai-credits.sql')+'\n'+sql('supabase/2026-09-21-ai-credit-topup-fee.sql')+'\n'+sql('supabase/2026-10-03-ai-credit-payment-safety.sql'));
  const promotion=sql('supabase/2026-10-04-ai-credit-test-promotion.sql');run('psql',args,promotion+'\n'+promotion);
  console.log(run('psql',args,sql('scripts/fixtures/ai-credit-promotion-assertions.sql')).trim());
  const results=await Promise.allSettled(Array.from({length:8},(_,i)=>promisify(execFile)(exe('psql'),[...args,'-tA','-c',
    `set role service_role;insert into ai_credit_orders(id,user_id,product_id,credits_micros,service_fee_cents,promotion_id,promotion_discount_id,promotion_discount_code,promotion_customer_id,promotion_email,promotion_expires_at,expected_paid_cents,checkout_session_id)
      values('45000000-0000-4000-8000-${String(i+101).padStart(12,'0')}','35000000-0000-4000-8000-000000000004','pdt_race',5000000,50,'75000000-0000-4000-8000-000000000099','dsc_race','FIXTURETEST','cus_race','race@fixture.test',now()+interval '1 hour',0,'session_race') returning id;`],{encoding:'utf8',windowsHide:true})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'Concurrent claims reserved multiple promotional checkouts');
  for(const result of results) if(result.status==='rejected') assert.match(result.reason.stderr,/duplicate key.*unique constraint/);
  const id=query("select id from ai_credit_orders where promotion_id='75000000-0000-4000-8000-000000000099';");
  const receipt=JSON.stringify({order_id:id,payment_id:'pay_race',paid_cents:0,refunds:[],event_type:'payment.succeeded',event_at:new Date().toISOString()});
  await Promise.all(Array.from({length:8},()=>promisify(execFile)(exe('psql'),[...args,'-tA','-c',
    `set role service_role;select filey_ai_wallet('reconcile_payment','35000000-0000-4000-8000-000000000004','${receipt}');`],{encoding:'utf8',windowsHide:true})));
  assert.equal(query("select balance_micros from ai_credit_accounts where user_id='35000000-0000-4000-8000-000000000004';"),'5000000');
  assert.equal(query("select count(*) from ai_credit_ledger where user_id='35000000-0000-4000-8000-000000000004';"),'1');
  const before=query('select jsonb_agg(to_jsonb(o) order by id) from ai_credit_orders o;');run('psql',args,promotion);
  assert.equal(query('select jsonb_agg(to_jsonb(o) order by id) from ai_credit_orders o;'),before,'Repeated promotion migration rewrote saved orders');
  console.log('PASS: eight simultaneous claims open one order; eight succeeded receipt retries grant exactly five Coin once; repeated upgrade preserves orders.');
} catch(error) {console.error(error.stderr?.toString()||error.stack||error.message);process.exitCode=1;}
finally {
  if(started) run('pg_ctl',['-D',temp,'-m','immediate','-w','stop']);
  if(resolve(temp).startsWith(resolve(tmpdir())+sep)&&dirname(temp)===resolve(tmpdir())) rmSync(temp,{recursive:true,force:true});
}
