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
