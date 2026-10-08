import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { boundedLines, mcpRelay, processRunner, sandboxCleanup, SandboxCleanupError, sandboxNetwork } from './runner.mjs';

const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const organization = 'fixture-org', otherOrganization = 'other-fixture-org';
const expectedTools = ['get_financial_summary', 'list_invoices', 'get_invoice', 'list_quotes', 'list_orders',
  'list_purchase_orders', 'list_customers', 'find_customer', 'list_products', 'list_low_stock', 'run_report'];
const modules = ['accounting', 'invoicing', 'inventory', 'quoting', 'orders', 'purchase-orders', 'customers', 'reports'];
const jwt = claims => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
  Buffer.from(JSON.stringify(claims)).toString('base64url'), 'fixture-signature'].join('.');
const tokens = new Map([owner, other].map(id => [id, jwt({ sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })]));
const anonKey = jwt({ role: 'anon' });
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function bounded(promise, milliseconds = 3000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Fixture operation did not complete promptly')), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
async function eventually(predicate) {
  await bounded((async () => {
    while (!predicate()) await new Promise(resolve => setTimeout(resolve, 10));
  })());
}

test('sandbox cleanup awaits exact container removal before detaching its network', async () => {
  const name = `filey-hermes-${randomUUID()}`, removal = deferred(), started = deferred(), calls = [];
  const finished = sandboxCleanup(name, { close: async () => { calls.push('network-close'); } }, async args => {
    calls.push(args); started.resolve(); await removal.promise; return { stdout: '' };
  });
  await started.promise;
  assert.equal(calls.length, 1, 'network must remain until the daemon acknowledges container removal');
  assert.equal(calls[0].at(-1), name); assert.ok(calls[0].includes('--force'));
  assert.ok(calls[0][0] === 'rm' || calls[0][0] === 'container' && calls[0][1] === 'rm');
  removal.resolve(); await finished;
  assert.equal(calls.at(-1), 'network-close');
});

test('cleanup accepts only this exact auto-removed container and fails closed on uncertain removal', async () => {
  const name = `filey-hermes-${randomUUID()}`;
  let detached = 0;
  await sandboxCleanup(name, { close: async () => { detached++; } }, async () => {
    throw Object.assign(new Error('Fixture command failed'), { stderr: `Error response from daemon: No such container: ${name}\n` });
  });
  assert.equal(detached, 1);
  for (const stderr of ['PRIVATE_DOCKER_OPERATOR_DETAIL', `Error response from daemon: No such container: ${name}-other\n`]) {
    detached = 0;
    await assert.rejects(sandboxCleanup(name, { close: async () => { detached++; } }, async () => {
      throw Object.assign(new Error('PRIVATE_DOCKER_OPERATOR_DETAIL'), { stderr });
    }), error => error.status === 503 && !error.message.includes('PRIVATE_DOCKER_OPERATOR_DETAIL') && !error.message.includes(name));
    assert.equal(detached, 0, 'an uncertain live container must keep its network attached');
  }
});

test('a lost network creation acknowledgement still removes the exact possibly-created network', async () => {
  const name = `filey-hermes-${randomUUID()}`, calls = [];
  await assert.rejects(sandboxNetwork(name, async args => {
    calls.push(args);
    if (args[1] === 'create') throw new Error('PRIVATE_DOCKER_CREATE_ACK');
    return { stdout: '' };
  }), error => error.status === 503 && !(error instanceof SandboxCleanupError) && !error.message.includes('PRIVATE_DOCKER_CREATE_ACK'));
  assert.deepEqual(calls, [['network', 'create', '--internal', '--driver', 'bridge', name], ['network', 'rm', name]]);
});

test('failed network creation accepts only an exact absent-network receipt as verified cleanup', async () => {
  const name = `filey-hermes-${randomUUID()}`;
  for (const stderr of [`Error response from daemon: network ${name} not found\n`,
    `Error response from daemon: No such network: ${name}\n`, `Error: No such network: ${name}\n`]) {
    const calls = [];
    await assert.rejects(sandboxNetwork(name, async args => {
      calls.push(args);
      if (args[1] === 'create') throw new Error('PRIVATE_DOCKER_CREATE_ACK');
      throw Object.assign(new Error('Fixture network already absent'), { stderr });
    }), error => error.status === 503 && !(error instanceof SandboxCleanupError));
    assert.deepEqual(calls.at(-1), ['network', 'rm', name]);
  }
});

test('uncertain network cleanup raises the admission-blocking class with no private Docker diagnostics', async () => {
  const name = `filey-hermes-${randomUUID()}`;
  for (const stderr of ['PRIVATE_DOCKER_CLEANUP_DETAIL', `Error response from daemon: network ${name}-other not found\n`]) {
    const calls = [];
    await assert.rejects(sandboxNetwork(name, async args => {
      calls.push(args);
      throw Object.assign(new Error('PRIVATE_DOCKER_CLEANUP_DETAIL'), { stderr });
    }), error => error instanceof SandboxCleanupError && error.status === 503 &&
      error.message === 'The isolated agent cleanup could not be verified.');
    assert.deepEqual(calls, [['network', 'create', '--internal', '--driver', 'bridge', name], ['network', 'rm', name]]);
  }
});

test('byte framing handles fragmented UTF-8 and coalesced small lines without truncation', () => {
  const stream = new PassThrough(), lines = [], violations = [];
  const framing = boundedLines(stream, 4, line => lines.push(line), () => violations.push(true));
  const bytes = Buffer.from('é\n');
  stream.write(bytes.subarray(0, 1)); stream.write(bytes.subarray(1));
  stream.write(Buffer.from('1\n22\n3\n'));
  assert.deepEqual(lines, ['é', '1', '22', '3']); assert.equal(violations.length, 0);
  framing.close(); stream.destroy();
});

test('an oversized unterminated child line is rejected in bytes before newline or further buffering', () => {
  for (const chunks of [[Buffer.alloc(9, 97)], [Buffer.alloc(4, 97), Buffer.alloc(5, 98)], [Buffer.from('éééé')]]) {
    const stream = new PassThrough(), lines = [], violations = [];
    const framing = boundedLines(stream, 7, line => lines.push(line), () => violations.push(true));
    for (const chunk of chunks) stream.write(chunk);
    assert.equal(violations.length, 1); assert.deepEqual(lines, []);
    stream.write(Buffer.from('\nagain\n')); assert.equal(violations.length, 1); assert.deepEqual(lines, []);
    framing.close(); stream.destroy();
  }
});

test('framing enforces total output separately and close releases its stream listeners', () => {
  const stream = new PassThrough(), lines = [], violations = [];
  const events = ['data', 'end', 'error'], baseline = events.map(event => stream.listenerCount(event));
  const framing = boundedLines(stream, 20, line => lines.push(line), () => violations.push(true), 8);
  stream.write(Buffer.from('ok\n')); stream.write(Buffer.from('12345\n'));
  assert.deepEqual(lines, ['ok']); assert.equal(violations.length, 1);
  framing.close(); framing.close();
  assert.deepEqual(events.map(event => stream.listenerCount(event)), baseline);
  stream.write(Buffer.from('after-close\n')); assert.deepEqual(lines, ['ok']); stream.destroy();
  const openStream = new PassThrough(), openLines = [];
  const openBaseline = events.map(event => openStream.listenerCount(event));
  const open = boundedLines(openStream, 20, line => openLines.push(line), () => assert.fail('unexpected overflow'));
  open.close(); assert.deepEqual(events.map(event => openStream.listenerCount(event)), openBaseline);
  openStream.write(Buffer.from('closed\n')); assert.deepEqual(openLines, []); openStream.destroy();
});

test('a malformed-frame callback cannot escape the stream or process later frames', () => {
  const stream = new PassThrough(); let calls = 0, violations = 0;
  const framing = boundedLines(stream, 20, () => { calls++; throw new Error('Fixture parser rejected a frame'); }, () => { violations++; });
  assert.doesNotThrow(() => stream.write(Buffer.from('first\nsecond\n')));
  assert.equal(calls, 1); assert.equal(violations, 1);
  stream.write(Buffer.from('third\n')); assert.equal(calls, 1); assert.equal(violations, 1);
  framing.close(); stream.destroy();
});

/** No deployed Supabase access: this fixture independently enforces user JWT,
 * current organization and private/shared record visibility. MCP is the real
 * built Node child; the parent relay is not replaced or mocked. */
async function fixture(t) {
  const state = { reads: [], writes: 0, requests: [], readGate: null };
  const rows = [
    { id: 1, user_id: owner, org_id: organization, name: 'Own customer' },
    { id: 2, user_id: other, org_id: organization, name: 'Other private customer' },
    { id: 3, user_id: other, org_id: organization, shared: true, name: 'Shared customer' },
    { id: 4, user_id: other, org_id: otherOrganization, name: 'Other workspace customer' },
  ];
  const profiles = new Map([[owner, organization], [other, otherOrganization]]);
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const reply = (body, status = 200) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    const identity = [...tokens].find(([, token]) => request.headers.authorization === `Bearer ${token}`)?.[0];
    const url = new URL(request.url, 'http://127.0.0.1');
    state.requests.push({ identity, path: url.pathname, method: request.method });
    if (!identity || request.headers.apikey !== anonKey) return reply({ error: 'Fixture unauthorized' }, 401);
    if (url.pathname === '/auth/v1/user') return reply({ id: identity, role: 'authenticated' });
    if (url.pathname === '/rest/v1/profiles') {
      if (url.searchParams.get('id') !== `eq.${identity}`) return reply({ error: 'Fixture profile mismatch' }, 403);
      return reply({ id: identity, org_id: profiles.get(identity) });
    }
    if (url.pathname === '/rest/v1/rpc/filey_module_access') return reply({ allowed: true, admin: false, modules });
    if (request.method !== 'GET') { state.writes++; return reply({ error: 'Fixture write denied' }, 403); }
    if (url.searchParams.get('org_id') !== `eq.${profiles.get(identity)}`) return reply({ error: 'Fixture scope mismatch' }, 403);
    state.reads.push({ identity, path: url.pathname });
    const visible = rows.filter(row => row.org_id === profiles.get(identity) && (row.user_id === identity || row.shared));
    if (state.readGate) await state.readGate.promise;
    reply(url.pathname === '/rest/v1/crm_customers' ? visible : []);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = { base: `http://127.0.0.1:${server.address().port}`, anonKey };
  const relays = [];
  t.after(async () => {
    state.readGate?.resolve();
    for (const relay of relays) relay.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  function createJob(userId = owner, org = profiles.get(userId)) {
    const job = { id: randomUUID(), identity: { userId, org, token: tokens.get(userId) }, controller: new AbortController(),
      authenticate: async () => ({ userId, org }) };
    const relay = mcpRelay(config, job); relays.push(relay);
    return { job, relay };
  }
  return { state, createJob };
}
async function initialize(relay, id = 'fixture-initialize') {
  const result = await relay.request(rpc(id, 'initialize', { protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'fixture-parent-relay', version: '1' } }));
  assert.equal(result.id, id); assert.equal(result.result.serverInfo.name, 'filey-erp');
  assert.equal(await relay.request({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}
function payload(response) {
  assert.equal(response.result.content[0].type, 'text');
  return JSON.parse(response.result.content[0].text);
}

test('actual relay initializes, discovers the fixed read-only contract and reads user-scoped records', async t => {
  const { state, createJob } = await fixture(t), { relay } = createJob();
  await initialize(relay);
  const listed = await relay.request(rpc('original-list-id', 'tools/list'));
  assert.equal(listed.id, 'original-list-id');
  assert.deepEqual(listed.result.tools.map(tool => tool.name).sort(), [...expectedTools].sort());
  const read = await relay.request(rpc(17, 'tools/call', { name: 'list_customers', arguments: {} }));
  assert.equal(read.id, 17);
  assert.deepEqual(payload(read).customers.map(customer => customer.name), ['Own customer', 'Shared customer']);
  assert.ok(state.reads.every(read => read.identity === owner)); assert.equal(state.writes, 0);
});

test('relay rejects general MCP methods and the real child refuses draft/write tools', async t => {
  const { state, createJob } = await fixture(t), { relay } = createJob();
  await initialize(relay);
  const before = state.requests.length;
  for (const method of ['resources/read', 'prompts/get', 'filey/sql', 'notifications/arbitrary'])
    await assert.rejects(relay.request(rpc(1, method, {})), error => error.status === 403);
  assert.equal(state.requests.length, before);
  const denied = await relay.request(rpc('denied-write', 'tools/call', { name: 'create_draft_invoice',
    arguments: { customer_name: 'Must never be saved', items: [] } }));
  assert.equal(denied.id, 'denied-write'); assert.equal(denied.result.isError, true);
  assert.equal(state.writes, 0); assert.equal(state.reads.length, 0);
  await assert.rejects(relay.request({ jsonrpc: '2.0', id: 1, method: 'notifications/initialized' }), /Invalid notification/);
});

test('concurrent replies retain string/numeric caller IDs and each job has its own verified identity', async t => {
  const { state, createJob } = await fixture(t);
  const first = createJob(), second = createJob(other);
  await Promise.all([initialize(first.relay), initialize(second.relay)]);
  const [list, read, otherRead] = await Promise.all([
    first.relay.request(rpc('101', 'tools/list')),
    first.relay.request(rpc(101, 'tools/call', { name: 'list_customers', arguments: {} })),
    second.relay.request(rpc('second-job', 'tools/call', { name: 'list_customers', arguments: {} })),
  ]);
  assert.equal(list.id, '101'); assert.ok(Array.isArray(list.result.tools));
  assert.equal(read.id, 101); assert.equal(payload(read).count, 2);
  assert.equal(otherRead.id, 'second-job');
  assert.deepEqual(payload(otherRead).customers.map(customer => customer.name), ['Other workspace customer']);
  assert.deepEqual(new Set(state.reads.map(read => read.identity)), new Set([owner, other]));
  assert.equal(state.writes, 0);
});

test('a misbound job cannot initialize the actual MCP child or read business records', async t => {
  const { state, createJob } = await fixture(t), { relay } = createJob(owner, otherOrganization);
  await assert.rejects(initialize(relay), /Record access is unavailable/);
  assert.equal(state.reads.length, 0); assert.equal(state.writes, 0);
});

test('cancellation and close during awaited authentication reject promptly before dispatch', async t => {
  const { state, createJob } = await fixture(t);
  for (const mode of ['cancel', 'close']) {
    const { job, relay } = createJob(); await initialize(relay);
    const entered = deferred(), release = deferred();
    job.authenticate = async () => { entered.resolve(); await release.promise; };
    const before = state.reads.length;
    const pending = relay.request(rpc(mode, 'tools/call', { name: 'list_customers', arguments: {} }));
    const rejected = assert.rejects(bounded(pending), error => error.status === 409);
    await entered.promise;
    if (mode === 'cancel') job.controller.abort(); else relay.close();
    release.resolve(); await rejected;
    assert.equal(state.reads.length, before);
    await assert.rejects(relay.request(rpc('after-stop', 'tools/list')), error => error.status === 409);
  }
});

test('five concurrent authentication completions cannot bypass the four-request relay bound', async t => {
  const { state, createJob } = await fixture(t), { job, relay } = createJob(); await initialize(relay);
  const releaseAuth = deferred(), entered = deferred(); let authenticating = 0;
  job.authenticate = async () => { if (++authenticating === 5) entered.resolve(); await releaseAuth.promise; };
  state.readGate = deferred();
  const outcomes = Array.from({ length: 5 }, (_, index) => relay.request(rpc(index, 'tools/call', {
    name: 'list_customers', arguments: {},
  })).then(value => ({ value }), error => ({ error })));
  await entered.promise; releaseAuth.resolve();
  await eventually(() => state.reads.length >= 4);
  state.readGate.resolve();
  const completed = await bounded(Promise.all(outcomes));
  assert.equal(completed.filter(result => result.value).length, 4);
  assert.equal(completed.filter(result => result.error?.status === 429).length, 1);
  assert.equal(state.reads.length, 4); assert.equal(state.writes, 0);
});

test('fictional MCP child null/array frames reject pending initialization without escaping into the parent', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'filey-malformed-mcp-')), script = join(directory, 'malformed.cjs');
  writeFileSync(script, `process.stdin.once('data', () => {
  process.stdout.write(process.argv[2] + '\\n');
  process.stdout.write('null\\n');
  setTimeout(() => process.exit(0), 50);
});
`, 'utf8');
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('filey-malformed-mcp-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const spawn = childProcess.spawn; let frame = 'null';
  const mocked = t.mock.method(childProcess, 'spawn', (command, args, options) => {
    assert.equal(command, process.execPath); assert.ok(args[0].endsWith('index.js'));
    return spawn(command, [script, frame], options);
  });
  syncBuiltinESMExports();
  try {
    for (frame of ['null', '[]']) {
      const relay = mcpRelay({ base: 'https://fictional.invalid', anonKey }, {
        id: randomUUID(), identity: { userId: owner, org: organization, token: tokens.get(owner) },
        controller: new AbortController(), authenticate: async () => {},
      });
      try {
        await assert.rejects(bounded(initialize(relay)), error => error.status === 503 && error.message === 'Record access is unavailable.');
        await assert.rejects(relay.request(rpc('after-malformed', 'tools/list')), error => error.status === 409);
      } finally { relay.close(); }
    }
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});

// The protocol child deliberately does not import Hermes or any provider SDK.
// A test-only spawn argument redirect keeps the real processRunner/stdout parser
// under test while the Python executable, environment and child process are real.
const pythonCandidates = [process.env.FILEY_HERMES_TEST_PYTHON,
  ...(process.platform === 'win32' ? [join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'), 'python'] : ['python3', 'python'])].filter(Boolean);
const python = pythonCandidates.find(command => {
  const result = childProcess.spawnSync(command, ['--version'], { windowsHide: true, timeout: 3000 });
  return !result.error && result.status === 0;
});

test('real protocol child errors become canonical insufficient-credit or generic messages, never raw details', { skip: !python }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'filey-fictional-protocol-')), script = join(directory, 'protocol.py');
  writeFileSync(script, `import json, os, sys
raw = json.load(sys.stdin)
mode = raw['messages'][0]['text']
assert raw['reasoning'] is False
assert not any(key.startswith(('SUPABASE_', 'OPENAI_', 'DEEPSEEK_')) for key in os.environ)
assert os.environ['FILEY_HERMES_PROXY_TOKEN'] == 'fixture-capability-only'
assert os.environ['FILEY_HERMES_SOURCE_DIR']
if mode in ('null-frame', 'array-frame'):
    print(json.dumps(None if mode == 'null-frame' else []), flush=True)
elif mode == 'complete':
    print(json.dumps({'type': 'text', 'text': 'Fixture reply'}), flush=True)
    print(json.dumps({'type': 'done', 'reason': 'complete'}), flush=True)
else:
    print(json.dumps({'type': 'error', 'code': mode, 'message': 'DO_NOT_EXPOSE_PROVIDER_SECRET'}), flush=True)
    sys.exit(1)
`, 'utf8');
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('filey-fictional-protocol-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const spawn = childProcess.spawn;
  const mocked = t.mock.method(childProcess, 'spawn', (command, args, options) => {
    assert.equal(command, python); assert.ok(args.at(-1).endsWith('runner.py'));
    return spawn(command, [...args.slice(0, -1), script], options);
  });
  syncBuiltinESMExports();
  try {
    const execute = processRunner({ local: true, python, source: directory, port: 16472 });
    const job = mode => ({ id: randomUUID(), messages: [{ role: 'user', text: mode }], reasoning: false,
      capability: 'fixture-capability-only', controller: new AbortController() });
    const emitted = [];
    await execute(job('complete'), event => emitted.push(event));
    assert.deepEqual(emitted, [{ type: 'text', text: 'Fixture reply' }]);
    await assert.rejects(execute(job('insufficient_credit'), () => {}), error =>
      error.status === 402 && error.message === 'Insufficient credit. Add Coin to continue.');
    for (const code of ['runtime_error', 'unknown-untrusted-code', 'null-frame', 'array-frame'])
      await assert.rejects(execute(job(code), () => {}), error => error.status === 503 &&
        error.message === 'The agent could not finish this task. Review any saved reply.');
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});
