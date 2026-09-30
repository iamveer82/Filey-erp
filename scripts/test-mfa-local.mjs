// Disposable PostgreSQL only: never uses a Supabase token or production DB.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bin=process.env.PGBIN || (process.platform==='win32' ? 'C:/Program Files/PostgreSQL/18/bin' : execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim());
const temp=mkdtempSync(join(tmpdir(),'filey-mfa-'));
const run=(name,args,input)=>execFileSync(join(bin,name+(process.platform==='win32'?'.exe':'')),args,{input,encoding:'utf8',windowsHide:true,stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});
const server=createServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
await new Promise(resolve=>server.close(resolve));
let started=false;
try {
  run('initdb',['-D',temp,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']);
  const socket=process.platform==='win32'?'':` -k "${temp}"`;
  run('pg_ctl',['-D',temp,'-l',join(temp,'server.log'),'-o',`-h 127.0.0.1 -p ${port}${socket}`,'-w','start']);
  started=true;
  const args=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'];
  const sql=file=>readFileSync(join(root,file),'utf8');
  const migration=sql('supabase/2026-09-30-mfa-enforcement.sql');
  const result=run('psql',args,sql('scripts/fixtures/mfa-setup.sql')+'\n'+migration+'\n'+migration+'\n'+sql('scripts/fixtures/mfa-assertions.sql'));
  console.log(result.trim());
  run('psql',args,"alter role authenticator set pgrst.db_pre_request='custom_security_hook';");
  assert.throws(()=>run('psql',args,migration),error=>/existing PostgREST pre-request hook must be integrated/.test(error.stderr.toString()));
  assert.equal(run('psql',[...args,'-tAc',"select rolconfig[1] from pg_roles where rolname='authenticator'"]).trim(),'pgrst.db_pre_request=custom_security_hook');
  console.log('PASS: migration is repeatable and refuses to replace an unrelated security hook.');
  const stripe=sql('supabase/2026-09-30-stripe-payment-integrity.sql');
  const paths=sql('supabase/2026-09-30-tool-path-integrity.sql');
  console.log(run('psql',args,sql('scripts/fixtures/backend-integrity-setup.sql')+'\n'+stripe+'\n'+stripe+'\n'+paths+'\n'+paths+'\n'+sql('scripts/fixtures/backend-integrity-assertions.sql')).trim());
  const races=await Promise.all(Array.from({length:8},()=>promisify(execFile)(join(bin,'psql'+(process.platform==='win32'?'.exe':'')),
    [...args,'-tAc',"set role service_role; set test.claims='{\"role\":\"service_role\"}'; select filey_settle_stripe_checkout('cs_race','invoice_payment',null,2,50,'AED','pi_race')->>'duplicate';"],{encoding:'utf8',windowsHide:true})));
  assert.equal(races.filter(result=>result.stdout.trim()==='false').length,1);
  assert.equal(run('psql',[...args,'-tAc',"select count(*) from invoice_payments where invoice_id=2"]).trim(),'1');
  console.log('PASS: eight concurrent Stripe deliveries record exactly one payment.');
  const workspaceAcl=sql('supabase/2026-09-30-workspace-billing-acl.sql');
  console.log(run('psql',args,sql('scripts/fixtures/workspace-billing-acl-setup.sql')+'\n'+workspaceAcl+'\n'+workspaceAcl+'\n'+sql('scripts/fixtures/workspace-billing-acl-assertions.sql')).trim());
} catch(error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode=1;
} finally {
  if(started) run('pg_ctl',['-D',temp,'-m','immediate','-w','stop']);
  if(resolve(temp).startsWith(resolve(tmpdir())+sep) && dirname(temp)===resolve(tmpdir())) rmSync(temp,{recursive:true,force:true});
}
