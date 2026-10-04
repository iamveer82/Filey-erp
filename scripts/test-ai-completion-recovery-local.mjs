// Disposable PostgreSQL and synthetic accounts only; no provider/network calls.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.env.PGBIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim());
const temp = mkdtempSync(join(tmpdir(), 'filey-ai-recovery-'));
const exe = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const run = (name, args, input) => execFileSync(exe(name), args, {
  input, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  stdio: name === 'pg_ctl' ? 'ignore' : ['pipe', 'pipe', 'pipe'],
});
const sql = file => readFileSync(join(root, file), 'utf8');
const server = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
const args = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'];
const query = text => run('psql', [...args, '-tA'], text).trim();
const parallelQuery = async text => (await promisify(execFile)(exe('psql'), [...args, '-tA', '-c', text], { encoding: 'utf8', windowsHide: true })).stdout.trim();
const owner = '38000000-0000-4000-8000-000000000004';
const request = { request_id: '58000000-0000-4000-8000-000000000101', run_id: '68000000-0000-4000-8000-000000000001', org_id: 'recovery-race', fingerprint: 'a'.repeat(64), model: 'filey-ai', amount_micros: 10000, markup_bps: 0 };
const call = (action, payload) => `set role service_role;select filey_ai_completion_recovery('${action}','${owner}','${JSON.stringify(payload).replaceAll("'", "''")}');`;
let started = false;
try {
  run('initdb', ['-D', temp, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  const socket = process.platform === 'win32' ? '' : ` -k "${temp}"`;
  run('pg_ctl', ['-D', temp, '-l', join(temp, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}${socket}`, '-w', 'start']);
  started = true;
  run('psql', args, `create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth,public to authenticated,anon,service_role;
    create table public.profiles(id uuid primary key references auth.users(id),org_id text not null);
    create table public.org_members(user_id uuid not null references auth.users(id),org_id text not null,primary key(user_id,org_id));`);
  for (const file of [
    'supabase/2026-09-20-ai-credits.sql',
    'supabase/2026-09-21-ai-credit-topup-fee.sql',
    'supabase/2026-10-03-ai-credit-payment-safety.sql',
    'supabase/2026-10-04-ai-credit-test-promotion.sql',
  ]) run('psql', args, sql(file));
  const migration = sql('supabase/2026-10-04-ai-completion-recovery.sql');
  run('psql', args, migration + '\n' + migration);
  console.log(run('psql', args, sql('scripts/fixtures/ai-completion-recovery-assertions.sql')).trim());

  const begun = await Promise.all(Array.from({ length: 8 }, () => parallelQuery(call('begin', request))));
  assert.equal(begun.map(JSON.parse).filter(result => result.dispatch === true).length, 1, 'Concurrent recovery starts dispatched multiple inferences');
  assert.ok(begun.map(JSON.parse).every(result => result.state === 'pending'));
  assert.equal(query(`select reserved_micros from ai_credit_accounts where user_id='${owner}'`), '10000');
  const settled = { ...request, charged_micros: 123, completion: { model: 'filey-ai', choices: [{ message: { role: 'assistant', content: 'Synthetic answer' } }] } };
  await Promise.all(Array.from({ length: 8 }, () => parallelQuery(call('settle', settled))));
  assert.equal(query(`select count(*) from ai_credit_ledger where user_id='${owner}' and kind='usage'`), '1', 'Settlement retries doubled the debit');
  assert.equal(query(`select balance_micros||','||reserved_micros from ai_credit_accounts where user_id='${owner}'`), '999877,0');
  assert.equal(JSON.parse(query(call('status', request))).completion.choices[0].message.content, 'Synthetic answer');

  // A failure acknowledgement may race settlement; either winner must be final.
  const race = { ...settled, request_id: '58000000-0000-4000-8000-000000000102' };
  query(call('begin', race));
  await Promise.all(Array.from({ length: 8 }, (_, index) => parallelQuery(call(index % 2 ? 'fail' : 'settle', race))));
  const result = JSON.parse(query(call('status', race)));
  assert.ok(['complete', 'failed'].includes(result.state));
  const charged = result.state === 'complete' ? 123 : 0;
  assert.equal(query(`select charged_micros from ai_credit_requests where id='${race.request_id}'`), String(charged));
  assert.equal(query(`select balance_micros||','||reserved_micros from ai_credit_accounts where user_id='${owner}'`), `${999877 - charged},0`);
  const before = query('select jsonb_agg(to_jsonb(r) order by request_id) from ai_completion_results r');
  run('psql', args, migration);
  assert.equal(query('select jsonb_agg(to_jsonb(r) order by request_id) from ai_completion_results r'), before, 'Repeated migration rewrote recovery receipts');
  console.log('PASS: eight concurrent starts dispatch once; eight settlement retries charge once; fail/settle races remain final; repeat migration preserves receipts.');
} catch (error) {
  console.error(error.stderr?.toString() || error.stack || error.message);
  process.exitCode = 1;
} finally {
  if (started) run('pg_ctl', ['-D', temp, '-m', 'immediate', '-w', 'stop']);
  if (resolve(temp).startsWith(resolve(tmpdir()) + sep) && dirname(temp) === resolve(tmpdir())) rmSync(temp, { recursive: true, force: true });
}
