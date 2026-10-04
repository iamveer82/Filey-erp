// Legacy settlement totals only: generated records, disposable local PostgreSQL,
// no provider calls, real customer database or checkout creation.
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
const temp=mkdtempSync(join(tmpdir(),'filey-stripe-totals-'));
const exe=name=>join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(name,args,input)=>execFileSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});
const sql=file=>readFileSync(join(root,file),'utf8');
const json=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const server=createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port; await new Promise(resolve=>server.close(resolve));
const args=['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'];
const query=text=>run('psql',[...args,'-tA'],text).trim();
const actor='d0000000-0000-4000-8000-000000000001';
const asActor=`set role authenticated;set request.jwt.claim.sub='${actor}';set request.jwt.claims='{"role":"authenticated","aal":"aal1"}';`;
const asService=`set role service_role;set request.jwt.claims='{"role":"service_role"}';`;
const cases=[
 {discount:1.01,tax_rate:5,items:[{qty:3,unit_price:7.13,tax_category:'S'},{qty:2,unit_price:1.02,tax_category:'Z'},{qty:1,unit_price:2.99,tax_category:'E'}]},
 {discount:3,tax_rate:5,items:[{qty:1,unit_price:10,custom:{__calc_mode:'manual',__manual_amount:'22.345',__disc_pct:'12.5',__tax_pct:'7.5'}},{qty:4,unit_price:1.15,custom:{__calc_mode:'formula',__formula_a:'Liters',Liters:'12.5 L'}}]},
 {discount:0,tax_rate:5,round_off:true,unit_price_formula:{a:'Liters'},items:[{qty:1,unit_price:1.15,custom:{Liters:'12.5'}},{qty:1,unit_price:2,custom:{Liters:'7.7',__disc_pct:'5'}}]},
 {discount:0,tax_rate:5,advance_applied:10,items:[{qty:2,unit_price:10},{qty:1,unit_price:4,description:'Delivery charge'}]},
];
let started=false;
try {
 run('initdb',['-D',temp,'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']);
 const socket=process.platform==='win32'?'':` -k "${temp}"`;
 run('pg_ctl',['-D',temp,'-l',join(temp,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -c wal_level=logical${socket}`,'-w','start']);started=true;
 run('psql',args,sql('scripts/fixtures/supabase-prerequisites.sql')+'\n'+sql('supabase/schema.sql'));
 run('psql',args,sql('supabase/2026-10-04-atomic-business-workflows.sql'));
 const migration=sql('supabase/2026-10-04-stripe-invoice-total-parity.sql');
 run('psql',args,migration+'\n'+migration);
 run('psql',args,`insert into auth.users(id,email,email_confirmed_at) values('${actor}','stripe-total-fixture@example.test',now());`);
 function seed(id,fixture) {
  const {items,...doc}=fixture;
  run('psql',args,`${asActor}
    insert into invoice_docs(id,number,status,currency,tax_rate,discount,round_off,unit_price_formula,advance_applied)
    select ${id},'STRIPE-FIXTURE-${id}','sent','AED',tax_rate,discount,coalesce(round_off,false),unit_price_formula,coalesce(advance_applied,0)
      from jsonb_populate_record(null::invoice_docs,${json(doc)});
    insert into invoice_doc_items(invoice_id,description,qty,unit_price,tax_category,custom,position)
      select ${id},coalesce(description,'Fixture line'),qty,unit_price,coalesce(tax_category,'S'),custom,ordinality-1
        from jsonb_array_elements(${json(items)}) with ordinality rows(value,ordinality),
          lateral jsonb_populate_record(null::invoice_doc_items,value);`);
 }
 for(const [index,fixture] of cases.entries()) {
  const id=930001+index;seed(id,fixture);
  const {items,...doc}=fixture;
  const expected=applyRoundOff(docTotals(items.map(item=>({...item,description:item.description||'Fixture',...splitItemMeta(item.custom)})),doc.discount,doc.tax_rate,doc.unit_price_formula),doc.round_off).total;
  const due=Math.round((expected-(doc.advance_applied||0))*100)/100;
  const call=(suffix,amount)=>`${asService}select filey_settle_stripe_checkout('cs_fixture_${id}_${suffix}','invoice_payment',null,${id},${amount},'AED','pi_fixture_${id}_${suffix}');`;
  assert.throws(()=>query(`${asActor}select filey_settle_stripe_checkout('cs_denied_${id}','invoice_payment',null,${id},1,'AED','pi_denied_${id}');`),error=>/permission denied/.test(error.stderr?.toString()||''));
  const partial=Math.round((due-.01)*100)/100;
  assert.equal(JSON.parse(query(call('partial',partial))).duplicate,false);
  assert.equal(query(`select status from invoice_docs where id=${id};`),'sent','Partial payment incorrectly paid current total');
  assert.equal(JSON.parse(query(call('partial',partial))).duplicate,true);
  assert.equal(query(`select count(*) from invoice_payments where invoice_id=${id};`),'1');
  assert.equal(JSON.parse(query(call('balance',.01))).duplicate,false);
  assert.equal(query(`select status from invoice_docs where id=${id};`),'paid','Modern total was not fully settled');
  assert.equal(Number(query(`select sum(amount) from invoice_payments where invoice_id=${id};`)),due);
 }
 console.log('PASS: mixed tax categories/discount cents, manual/formula calculations, round-off, charge rows and advances match shared preview/PDF totals; each partial/full boundary and identical replay is correct; clients cannot settle.');
 assert.throws(()=>query(`${asService}select filey_settle_stripe_checkout('cs_bad_currency','invoice_payment',null,930001,1,'USD','pi_bad_currency');`),error=>/currency or reference mismatch/.test(error.stderr?.toString()||''));
 assert.throws(()=>query(`${asService}select filey_settle_stripe_checkout('cs_fixture_930001_partial','invoice_payment',null,930001,777,'AED','pi_fixture_930001_partial');`),error=>/replay mismatch/.test(error.stderr?.toString()||''));
 assert.throws(()=>query(`${asService}select filey_settle_stripe_checkout('cs_reused_intent','invoice_payment',null,930001,1,'AED','pi_fixture_930001_partial');`),error=>/replay mismatch/.test(error.stderr?.toString()||''));
 const licence=`${asService}select filey_settle_stripe_checkout('cs_licence_fixture','lite_license','${actor}',null,99,'USD','pi_licence_fixture');`;
 assert.equal(JSON.parse(query(licence)).duplicate,false);
 assert.equal(JSON.parse(query(licence)).duplicate,true);
 assert.equal(query("select count(*) from licenses where stripe_payment_intent='pi_licence_fixture';"),'1');
 console.log('PASS: licence fulfilment/replay remains once-only; currency mismatch, changed replay and reused intent are rejected after the override.');
 seed(930005,{discount:0,tax_rate:5,items:[{qty:1,unit_price:10}]});
 run('psql',args,`create function fixture_stripe_payment_failure() returns trigger language plpgsql as $$ begin
   if new.invoice_id=930005 then raise exception 'Synthetic legacy payment failure'; end if;return new;end $$;
   create trigger fixture_stripe_payment_failure before insert on invoice_payments for each row execute function fixture_stripe_payment_failure();`);
 assert.throws(()=>query(`${asService}select filey_settle_stripe_checkout('cs_rollback','invoice_payment',null,930005,1,'AED','pi_rollback');`),error=>/Synthetic legacy payment failure/.test(error.stderr?.toString()||''));
 assert.equal(query("select count(*) from stripe_settled_checkouts where session_id='cs_rollback';"),'0');
 assert.equal(query('select count(*) from invoice_payments where invoice_id=930005;'),'0');
 assert.equal(query('select status from invoice_docs where id=930005;'),'sent');
 seed(930006,{discount:0,tax_rate:5,items:[{qty:1,unit_price:10}]});
 run('psql',args,"alter table invoice_doc_items disable trigger all;update invoice_doc_items set org_id='foreign-fixture-org' where invoice_id=930006;alter table invoice_doc_items enable trigger all;");
 assert.throws(()=>query(`${asService}select filey_settle_stripe_checkout('cs_malformed','invoice_payment',null,930006,1,'AED','pi_malformed');`),error=>/workspace reconciliation/.test(error.stderr?.toString()||''));
 assert.equal(query("select count(*) from stripe_settled_checkouts where session_id='cs_malformed';"),'0');
 seed(930007,{discount:0,tax_rate:0,items:[{qty:1,unit_price:10}]});
 const command=`${asService}select filey_settle_stripe_checkout('cs_parallel','invoice_payment',null,930007,10,'AED','pi_parallel');`;
 const outcomes=await Promise.all(Array.from({length:8},()=>promisify(execFile)(exe('psql'),[...args,'-tA','-c',command],{encoding:'utf8',windowsHide:true})));
 const receipts=outcomes.map(result=>JSON.parse(result.stdout.trim()));
 assert.equal(receipts.filter(result=>!result.duplicate).length,1);
 assert.equal(receipts.filter(result=>result.duplicate).length,7);
 assert.equal(query('select count(*) from invoice_payments where invoice_id=930007;'),'1');
 assert.equal(query("select count(*) from stripe_settled_checkouts where session_id='cs_parallel';"),'1');
 assert.equal(query('select status from invoice_docs where id=930007;'),'paid');
 console.log('PASS: failed payment rolls back receipt/status, malformed historical ownership is preserved/rejected, and eight concurrent settlement retries create one payment/receipt.');
} catch(error) {console.error(error.stderr?.toString()||error.stack||error.message);process.exitCode=1;}
finally {
 if(started)run('pg_ctl',['-D',temp,'-m','immediate','-w','stop']);
 if(resolve(temp).startsWith(resolve(tmpdir())+sep)&&dirname(temp)===resolve(tmpdir())&&temp.startsWith(join(tmpdir(),'filey-stripe-totals-')))rmSync(temp,{recursive:true,force:true});
}
