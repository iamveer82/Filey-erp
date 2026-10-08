// Focused hosted/app parity test in fresh disposable PostgreSQL. No credentials.
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {featureFunctionSources,hostedDraftSchemaIssues,workflowSchemaIssues} from './runtime-schema-checks.mjs';
import {docTotals,sanitizeCustomColumns,RESERVED_ITEM_COLUMNS,DEFAULT_COLUMN_LABELS} from '../supabase/functions/_shared/docItems.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bin=process.env.PGBIN||(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim());
const temp=mkdtempSync(join(tmpdir(),'filey-hosted-'));
const exe=name=>join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(name,args,input)=>execFileSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});
const sql=file=>readFileSync(join(root,file),'utf8');
const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));
const port=server.address().port;await new Promise(done=>server.close(done));
const args=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'];
const query=text=>run('psql',[...args,'-tA'],text).trim();
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const command=async text=>(await promisify(execFile)(exe('psql'),[...args,'-tA','-c',text],{encoding:'utf8',windowsHide:true})).stdout.trim();
let started=false;
try {
 run('initdb',['-D',temp,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']);
 run('pg_ctl',['-D',temp,'-l',join(temp,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -c wal_level=logical${process.platform==='win32'?'':` -k "${temp}"`}`,'-w','start']);started=true;
 run('psql',args,sql('scripts/fixtures/supabase-prerequisites.sql')+sql('supabase/schema.sql'));
 const [setup,checks]=sql('scripts/fixtures/hosted-draft-parity.sql').split('-- TEST CURRENT HOSTED CONTRACT');
 run('psql',args,setup);
 const owner='b8200000-0000-4000-8000-000000000001';
 const org=query(`select org_id from profiles where id='${owner}';`);
 const input=JSON.stringify({customer_name:'New buyer',items:[{description:'Item',qty:2,unit_price:10}]});
 const legacy=sql('supabase/2026-09-30-channel-agent-drafts.sql').replace(/^(?:begin;|commit;)\s*$/gmi,'');
 const oldResult=JSON.parse(query(`begin;${legacy}set request.jwt.claims='{"role":"service_role"}';select filey_channel_create_draft('${owner}','${org}','invoice','${input}');rollback;`));
 assert.match(oldResult.number,/^INV-\d{4}-A/,'Regression no longer reproduces against previous hosted function');
 console.log('REPRODUCED: old hosted creator ignores INV-AUDIT-029-26 and generates random invoice numbering.');
 run('psql',args,checks);console.log('PASS: hosted SQL behavior and preserved business inputs.');
 const reservedBefore=query('select count(*) from document_number_reservations;');
 for(const column of [
   ...[...RESERVED_ITEM_COLUMNS].map(key=>({key,label:'T.Liters'})),
   ...[...DEFAULT_COLUMN_LABELS].flatMap(label=>['  ','\t','\u00a0\uFEFF'].map(space=>({key:'liters',label:`${space}${label.toUpperCase()}${space}`}))),
 ]) {
   const bad={customer_name:'New buyer',custom_columns:[column],price_by:column.key,
     items:[{description:'Item',qty:50,unit_price:0.20,custom:{[column.key]:'1000'}}]};
   assert.throws(()=>query(`set request.jwt.claims='{"role":"service_role"}';select filey_channel_create_draft('${owner}','${org}','invoice',${literal(JSON.stringify(bad))});`),
     error=>/Invalid invoice custom column/.test(error.stderr?.toString()||''),JSON.stringify(column));
 }
 assert.equal(query('select count(*) from document_number_reservations;'),reservedBefore);
 // Exercise the actual shared UI math against SQL receipts, not a copy of its
 // implementation. Each synthetic draft is rolled back after reading the result.
 const arithmetic=[
   {tax_rate:5.123,items:[{description:'Stored VAT precision',qty:1000000,unit_price:1}]},
   {tax_rate:5,items:[{description:'Third',qty:0.333,unit_price:19.99},{description:'Tiny',qty:0.001,unit_price:1}]},
   {tax_rate:5,items:[{description:'Half cent',qty:1.005,unit_price:1},{description:'Half cent two',qty:2.675,unit_price:1}]},
   {tax_rate:5,price_by:'liters',custom_columns:[{key:'liters',label:'T.Liters'}],items:[
     {description:'Fractional liters',qty:15,unit:'L',unit_price:4.10,custom:{liters:'300.125'}},
     {description:'Fractional liters two',qty:50,unit:'L',unit_price:0.20,custom:{liters:'1000.025'}}]},
   {tax_rate:5,price_by:'liters',custom_columns:[{key:'liters',label:'T.Liters'}],items:[
     {description:'Half cent multiplier',qty:1,unit:'L',unit_price:1,custom:{liters:'1.005'}},
     {description:'Fractional rate',qty:6,unit:'L',unit_price:0.29,custom:{liters:'1200.125'}}]},
   {tax_rate:7.5,price_by:'liters',custom_columns:[{key:'liters',label:'T.Liters'}],items:[
     {description:'Fractional VAT',qty:1,unit:'L',unit_price:1.15,custom:{liters:'12.5'}}]},
 ];
 for(const sample of arithmetic) {
   assert.deepEqual(sanitizeCustomColumns(sample.custom_columns??[]),sample.custom_columns??[]);
   const expected=docTotals(sample.items,0,sample.tax_rate,sample.price_by?{a:sample.price_by,b:'unit_price'}:undefined);
   const actual=JSON.parse(query(`begin;set request.jwt.claims='{"role":"service_role"}';select filey_channel_create_draft('${owner}','${org}','invoice',${literal(JSON.stringify({customer_name:'New buyer',...sample}))});rollback;`));
   assert.equal(actual.total,expected.total,JSON.stringify(sample));
 }
 for(const [kind,key,pattern,input] of [
   ['quote','quote_number_format','QT-AUDIT-{000}',{customer_name:'New buyer',items:[{description:'Quote item',qty:1.005,unit_price:1}]}],
   ['po','purchase_order_number_format','PO-AUDIT-{000}',{supplier_name:'New supplier',items:[{description:'PO item',qty:2.675,unit_cost:1}]}],
 ]) {
   const result=JSON.parse(query(`begin;set request.jwt.claims='{"role":"service_role"}';insert into app_settings(user_id,org_id,key,value) values('${owner}','${org}','${key}','${pattern}');
     select jsonb_build_array(filey_channel_create_draft('${owner}','${org}','${kind}',${literal(JSON.stringify(input))}),filey_channel_create_draft('${owner}','${org}','${kind}',${literal(JSON.stringify(input))}));rollback;`));
   assert.deepEqual(result.map(row=>row.number),[pattern.replace('{000}','001'),pattern.replace('{000}','002')]);
   const items=input.items.map(item=>({...item,unit_price:item.unit_price??item.unit_cost}));
   assert.equal(result[0].total,docTotals(items,0,0).total);
 }
 console.log('PASS: every editor-reserved key/label rejected before allocation; fractional/custom pricing matches shared docTotals; quote/PO saved formats stay sequential.');
 // Upgrade repeatability preserves the exact current rows and reservations.
 const snapshot=()=>query("select jsonb_build_array((select jsonb_agg(t order by id) from invoice_docs t),(select jsonb_agg(t order by id) from invoice_doc_items t),(select jsonb_agg(t order by number) from document_number_reservations t));");
 const before=snapshot(),migration=sql('supabase/2026-10-08-hosted-draft-parity.sql');
 run('psql',args,migration+migration);assert.equal(snapshot(),before);
 const catalog=JSON.parse(query(sql('supabase/verify-runtime-schema.sql')));
 const sources=featureFunctionSources(...['2026-10-04-atomic-document-save.sql','2026-10-04-document-number-authority.sql','2026-10-04-atomic-recurrence.sql','2026-10-04-atomic-business-workflows.sql','2026-10-04-atomic-lead-setup.sql','2026-10-04-stripe-invoice-total-parity.sql','2026-10-07-document-save-performance.sql','2026-10-08-hosted-draft-parity.sql'].map(file=>sql('supabase/'+file)));
 assert.deepEqual(hostedDraftSchemaIssues(catalog,sources),[]);assert.deepEqual(workflowSchemaIssues(catalog,sources),[]);
 const reserve=id=>`set role authenticated;set request.jwt.claim.sub='${owner}';set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';select filey_reserve_document_number('invoice','INV-AUDIT-{000}-26',2026,'${id}','${owner}','${org}');`;
 const requests=Array.from({length:4},(_,i)=>`b8300000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
 const results=await Promise.all([...requests.map(id=>command(reserve(id))),...requests.map(()=>command(`set request.jwt.claims='{"role":"service_role"}';select filey_channel_create_draft('${owner}','${org}','invoice','${input}')->>'number';`))]);
 assert.deepEqual(results.sort(),Array.from({length:8},(_,i)=>`INV-AUDIT-${String(i+33).padStart(3,'0')}-26`));
 assert.equal(await command(reserve(requests[0])),results.find(n=>n===query(`select number from document_number_reservations where request_id='${requests[0]}';`)));
 console.log('PASS: concurrent hosted/app reservations share one sequence; same request replays; repeat upgrades preserve rows; runtime contracts match.');
} finally {
 if(started)run('pg_ctl',['-D',temp,'-m','immediate','-w','stop']);
 if(resolve(temp).startsWith(resolve(tmpdir())+sep)&&dirname(temp)===resolve(tmpdir()))rmSync(temp,{recursive:true,force:true});
}
