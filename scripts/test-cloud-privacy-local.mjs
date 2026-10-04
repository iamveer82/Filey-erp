// Actual canonical schema + synthetic accounts in a disposable PostgreSQL.
// No Supabase credentials, real records, provider calls or deployment.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bin=process.env.PGBIN||(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim());
const temp=mkdtempSync(join(tmpdir(),'filey-cloud-privacy-'));
const exe=name=>join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(name,args,input)=>execFileSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});
const sql=file=>readFileSync(join(root,file),'utf8');
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const args=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'];
const query=text=>run('psql',[...args,'-tA'],text).trim();
let started=false;
try {
  execFileSync(process.execPath,[join(root,'scripts/build-schema-bootstrap.mjs')],{cwd:root,stdio:'inherit',windowsHide:true});
  run('initdb',['-D',temp,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']);
  const socket=process.platform==='win32'?'':` -k "${temp}"`;
  run('pg_ctl',['-D',temp,'-l',join(temp,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -c wal_level=logical${socket}`,'-w','start']);started=true;
  run('psql',args,sql('scripts/fixtures/supabase-prerequisites.sql'));
  const installer=sql('supabase/schema.sql');run('psql',args,installer);
  run('psql',args,sql('scripts/fixtures/cloud-privacy-setup.sql'));
  // Recreate the exact original bootstrap definer body/default grant for the
  // baseline repro, even after the canonical installer contains the fix.
  const oldPrune=installer.match(/create or replace function public\.prune_tool_runs\(max_age interval[\s\S]*?\$\$;/i)?.[0];
  assert(oldPrune&&!oldPrune.includes('filey_tool_path_owned'),'Legacy baseline extraction must remain the original unscoped body');
  run('psql',args,oldPrune+'\ngrant execute on function public.prune_tool_runs(interval) to authenticated;');
  console.log(run('psql',args,sql('scripts/fixtures/cloud-privacy-baseline.sql')).trim());
  const changes=['supabase/2026-10-04-cloud-storage-privacy.sql','supabase/2026-10-04-scheduled-agent-privacy.sql'];
  for(const file of changes) run('psql',args,sql(file)+'\n'+sql(file));
  console.log(run('psql',args,sql('scripts/fixtures/cloud-privacy-assertions.sql')).trim());
  const catalog=JSON.parse(query(sql('supabase/verify-runtime-schema.sql')));
  mkdirSync(join(root,'output'),{recursive:true});const path=join(root,'output/cloud-privacy-catalog.json');writeFileSync(path,JSON.stringify({rows:[{catalog}]},null,2)+'\n');
  execFileSync(process.execPath,[join(root,'scripts/check-cloud-schema.mjs'),path],{cwd:root,stdio:'inherit',windowsHide:true});
  // An upgrade/repeat must preserve object metadata and privacy, not only rows
  // in public tables. The canonical final stage is the same reviewed upgrade.
  const before=query('select jsonb_agg(to_jsonb(o) order by id) from storage.objects o;');
  run('psql',args,installer);
  assert.equal(query('select jsonb_agg(to_jsonb(o) order by id) from storage.objects o;'),before);
  assert.equal(query("select count(*) from storage.buckets where id in ('files','tool-inputs','tool-outputs','team-attachments') and public is distinct from false;"),'0');
  assert.equal(query("select has_function_privilege('authenticated','public.prune_tool_runs(interval)','execute');"),'f');
  console.log('PASS: repeated canonical installer preserves synthetic stored objects and keeps privacy/service ACL repairs.');
} catch(error) {console.error(error.stderr?.toString()||error.stack||error.message);process.exitCode=1;}
finally {
  if(started) run('pg_ctl',['-D',temp,'-m','immediate','-w','stop']);
  // Resolve and verify this generated temporary cluster before removal.
  if(resolve(temp).startsWith(resolve(tmpdir())+sep)&&dirname(temp)===resolve(tmpdir())) rmSync(temp,{recursive:true,force:true});
}
