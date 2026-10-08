// Disposable PostgreSQL, synthetic documents only; no cloud credentials.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bin=process.env.PGBIN||(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim());
const temp=mkdtempSync(join(tmpdir(),'filey-public-links-'));
const run=(name,args,input)=>execFileSync(join(bin,name+(process.platform==='win32'?'.exe':'')),args,{input,encoding:'utf8',windowsHide:true,stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});
const sql=path=>readFileSync(join(root,path),'utf8');
const server=createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port; await new Promise(resolve=>server.close(resolve));
let started=false;
try {
  run('initdb',['-D',temp,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']);
  const socket=process.platform==='win32'?'':` -k "${temp}"`;
  run('pg_ctl',['-D',temp,'-l',join(temp,'server.log'),'-o',`-h 127.0.0.1 -p ${port}${socket}`,'-w','start']); started=true;
  const args=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'];
  const migration=sql('supabase/2026-10-08-public-link-isolation.sql');
  run('psql',args,sql('scripts/fixtures/rls-setup.sql')+'\n'+sql('scripts/fixtures/public-document-setup.sql')+'\n'
    +sql('supabase/2026-09-12-shared-record-permissions.sql')+'\n'+sql('scripts/fixtures/public-link-setup.sql')+'\n'+migration+'\n'+migration);
  console.log(run('psql',args,sql('scripts/fixtures/public-link-assertions.sql')).trim());
  const snapshot=()=>run('psql',[...args,'-tAc',"select jsonb_agg(jsonb_build_array(kind,new_token,get_shared_doc(new_token))) from fixture_public_links;"]).trim();
  const before=snapshot(); run('psql',args,migration); assert.equal(snapshot(),before);
  console.log('PASS: repeat migration preserves explicitly enabled links and their customer output.');
} finally {
  if(started)run('pg_ctl',['-D',temp,'-m','immediate','-w','stop']);
  const target=realpathSync(temp),allowed=realpathSync(tmpdir());
  assert(target.startsWith(allowed+sep)&&basename(target).startsWith('filey-public-links-')&&target!==allowed);
  rmSync(target,{recursive:true,force:true});
}
