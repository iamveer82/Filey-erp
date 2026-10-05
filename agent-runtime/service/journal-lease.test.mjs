import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { JobStore } from './store.mjs';

const owner = '11111111-1111-4111-8111-111111111111', org = 'fictional-lease-workspace';
const privateText = 'Fictional private invoice text for the journal lease check';
const storeURL = new URL('./store.mjs', import.meta.url).href;
function fixture(t, beforeCleanup) {
  const directory = mkdtempSync(join(tmpdir(), 'filey-journal-lease-')), path = join(directory, 'jobs.db');
  const key = randomBytes(32), id = randomUUID(), opened = new Set();
  const open = (selectedKey = key) => { const store = new JobStore(path, selectedKey); opened.add(store); return store; };
  const close = store => { store.close(); opened.delete(store); };
  const running = store => {
    store.create(id, owner, org, 'fictional-fingerprint', { text: privateText });
    store.running(id); store.event(id, { type: 'text', text: 'Fictional partial reply' });
  };
  t.after(async () => {
    await beforeCleanup?.();
    for (const store of opened) close(store);
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('filey-journal-lease-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, path, key, id, open, close, running };
}

test('a second same/different-key store cannot interrupt a live job or mutate its receipt', t => {
  const app = fixture(t), store = app.open(); app.running(store);
  const original = store.view(store.row(app.id), 0);
  for (const key of [app.key, randomBytes(32)]) {
    assert.throws(() => app.open(key), /Another pilot process owns this journal/);
    assert.deepEqual(store.view(store.row(app.id), 0), original);
    assert.equal(store.row(app.id).status, 'running');
  }
  assert.equal(store.event(app.id, { type: 'text', text: 'The original owner still writes normally' }), true);
  assert.equal(store.row(app.id).sequence, 2);
  const lease = readFileSync(`${app.path}.lease`);
  assert.equal(lease.includes(Buffer.from(privateText)), false);
  assert.equal(lease.includes(app.key), false);
});

test('clean close releases the lease and restart interrupts old work exactly once', t => {
  const app = fixture(t); let store = app.open(); app.running(store); app.close(store);
  store = app.open();
  const interrupted = store.view(store.row(app.id), 0);
  assert.equal(interrupted.status, 'interrupted');
  assert.deepEqual(interrupted.events.map(item => item.event.type), ['text', 'done']);
  assert.equal(interrupted.last_sequence, 2);
  assert.equal(interrupted.events[0].event.text, 'Fictional partial reply');
  app.close(store); store = app.open();
  assert.deepEqual(store.view(store.row(app.id), 0), interrupted, 'another restart cannot replay work or append another interruption');
});

test('wrong-key initialization leaves the running receipt intact and releases its lease', t => {
  const app = fixture(t), store = app.open(); app.running(store); app.close(store);
  assert.throws(() => app.open(randomBytes(32)));
  const inspection = new DatabaseSync(app.path, { readOnly: true });
  try {
    const row = inspection.prepare('SELECT status,sequence FROM jobs WHERE id=?').get(app.id);
    assert.equal(row.status, 'running'); assert.equal(row.sequence, 1);
  } finally { inspection.close(); }
  const recovered = app.open();
  assert.equal(recovered.row(app.id).status, 'interrupted'); assert.equal(recovered.row(app.id).sequence, 2);
});

test('process death releases the OS lease and recovery retains one durable interruption', { timeout: 10_000 }, async t => {
  let child, ended;
  const app = fixture(t, async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (ended) await ended;
  });
  const program = `import { JobStore } from ${JSON.stringify(storeURL)};
const store = new JobStore(process.env.FILEY_LEASE_FIXTURE_PATH, Buffer.from(process.env.FILEY_LEASE_FIXTURE_KEY, 'base64'));
const id = process.env.FILEY_LEASE_FIXTURE_ID;
store.create(id, '${owner}', '${org}', 'fictional-fingerprint', { text: ${JSON.stringify(privateText)} });
store.running(id); store.event(id, { type: 'text', text: 'Fictional partial reply' });
process.send({ type: 'ready', status: store.row(id).status });
setInterval(() => {}, 1000);
`;
  const inherited = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  child = spawn(process.execPath, ['--input-type=module', '--eval', program], {
    env: { ...inherited, FILEY_LEASE_FIXTURE_PATH: app.path, FILEY_LEASE_FIXTURE_KEY: app.key.toString('base64'), FILEY_LEASE_FIXTURE_ID: app.id },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  const ready = await Promise.race([
    new Promise(resolve => child.once('message', resolve)),
    ended.then(() => { throw new Error('Fictional lease owner exited before readiness'); }),
  ]);
  assert.deepEqual(ready, { type: 'ready', status: 'running' });
  assert.throws(() => app.open(), /Another pilot process owns this journal/);
  assert.equal(child.kill('SIGKILL'), true); await ended;
  let recovered = app.open();
  const receipt = recovered.view(recovered.row(app.id), 0);
  assert.equal(receipt.status, 'interrupted'); assert.equal(receipt.last_sequence, 2);
  assert.deepEqual(receipt.events.map(item => item.event.type), ['text', 'done']);
  app.close(recovered); recovered = app.open();
  assert.deepEqual(recovered.view(recovered.row(app.id), 0), receipt);
  assert.equal(readFileSync(`${app.path}.lease`).includes(Buffer.from(privateText)), false);
});
