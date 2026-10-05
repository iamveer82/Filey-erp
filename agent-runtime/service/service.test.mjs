import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuration, PublicError } from './config.mjs';
import { JobStore } from './store.mjs';
import { authenticator } from './auth.mjs';
import { creditProxy } from './credits.mjs';
import { createPilot } from './server.mjs';
import { sandboxNetwork } from './runner.mjs';

const user = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const key = randomBytes(32);
const config = { dbPath: ':memory:', encryptionKey: key, origins: ['https://app.gofiley.com'],
  concurrency: 2, perUser: 1, timeout: 3000, retention: 86400000,
  base: 'https://example.supabase.co', anonKey: 'sb_publishable_test' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const claims = (extra = {}) => `header.${Buffer.from(JSON.stringify({ sub: user, role: 'authenticated', ...extra })).toString('base64url')}.signature`;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('configuration fails closed on remote dev execution, secrets and unsafe origins', () => {
  const env = { SUPABASE_URL: config.base, SUPABASE_ANON_KEY: config.anonKey,
    FILEY_HERMES_DATA_KEY: key.toString('base64'), FILEY_HERMES_DEV_LOCAL: '1' };
  assert.equal(configuration(env).host, '127.0.0.1');
  assert.throws(() => configuration({ ...env, NODE_ENV: 'production' }), /forbidden/);
  assert.throws(() => configuration({ ...env, SUPABASE_ANON_KEY: 'sb_secret_bad' }), /publishable/);
  assert.throws(() => configuration({ ...env, SUPABASE_URL: 'https://attacker.com/path' }), /origin/);
  assert.throws(() => configuration({ ...env, FILEY_HERMES_ALLOWED_ORIGINS: 'http://app.gofiley.com' }), /origins/);
  assert.throws(() => configuration({ ...env, FILEY_HERMES_DEV_LOCAL: '' }), /sandbox/);
});

test('production execution requires an isolated internal network with a private gateway', async () => {
  const name = `filey-hermes-${randomUUID()}`;
  for (const unsafe of [{ Internal: false }, { Driver: 'host' }, { IPAM: { Config: [{ Gateway: '8.8.8.8' }] } }]) {
    const calls = [];
    await assert.rejects(sandboxNetwork(name, async args => {
      calls.push(args);
      return { stdout: JSON.stringify([{ Name: name, Internal: true, Driver: 'bridge', IPAM: { Config: [{ Gateway: '172.21.0.1' }] }, ...unsafe }]) };
    }), /network is unavailable/);
    assert.deepEqual(calls[0], ['network', 'create', '--internal', '--driver', 'bridge', name]);
    assert.deepEqual(calls.at(-1), ['network', 'rm', name]);
  }
  const safe = await sandboxNetwork(name, async () => ({ stdout: JSON.stringify([{ Name: name, Internal: true, Driver: 'bridge', IPAM: { Config: [{ Gateway: '172.21.0.1' }] } }]) }));
  assert.equal(safe.gateway, '172.21.0.1'); await safe.close();
});

test('journal encrypts private prompts/results and never replays interrupted work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'filey-job-test-')), path = join(directory, 'jobs.db'), id = randomUUID();
  try {
    let store = new JobStore(path, key);
    store.create(id, user, 'org', 'hash', { prompt: 'PRIVATE-INVOICE-123' });
    store.running(id); store.event(id, { type: 'text', text: 'PRIVATE-CUSTOMER-RESULT' });
    store.close();
    assert.equal(readFileSync(path).includes(Buffer.from('PRIVATE-INVOICE-123')), false);
    assert.equal(readFileSync(path).includes(Buffer.from('PRIVATE-CUSTOMER-RESULT')), false);
    assert.throws(() => new JobStore(path, randomBytes(32)));
    store = new JobStore(path, key);
    const view = store.view(store.row(id), 0);
    assert.equal(view.status, 'interrupted');
    assert.equal(view.events[0].event.text, 'PRIVATE-CUSTOMER-RESULT');
    assert.deepEqual(view.events.map(item => item.sequence), [1, 2]);
    assert.throws(() => store.open('different-row', store.row(id).payload, store.row(id)));
    store.db.prepare('UPDATE jobs SET owner=? WHERE id=?').run(other, id);
    assert.throws(() => store.view(store.row(id), 0));
    store.db.prepare('UPDATE jobs SET owner=? WHERE id=?').run(user, id);
    assert.equal(store.view(store.row(id)).status, 'interrupted');
    const second = new JobStore(':memory:', randomBytes(32));
    assert.notEqual(store.fingerprint({ text: 'guess' }), second.fingerprint({ text: 'guess' })); second.close();
    store.finish(id, 'completed', 'must not overwrite');
    assert.equal(store.row(id).status, 'interrupted');
    assert.throws(() => store.create(id, other, 'org', 'hash', {}), error => error.status === 404);
    assert.throws(() => store.create(id, user, 'org', 'other-hash', {}), error => error.status === 409);
    store.prune(Date.now() + 1); assert.equal(store.row(id), undefined); store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('auth verifies current user, MFA, profile organization and membership on every call', async () => {
  let calls = [], profileOrg = 'org', allowed = true, factors;
  const verify = authenticator(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return json({ id: user, email_confirmed_at: 'yes', factors });
    if (url.includes('/profiles?')) return json([{ id: user, org_id: profileOrg }]);
    return json({ allowed });
  });
  assert.equal((await verify(claims(), 'org')).userId, user);
  assert.equal(calls.length, 3); assert.ok(calls.every(call => call.init.redirect === 'error'));
  await assert.rejects(verify(claims({ role: 'service_role' }), 'org'), error => error.status === 401);
  profileOrg = 'other'; await assert.rejects(verify(claims(), 'org'), /workspace changed/);
  profileOrg = 'org'; allowed = false; await assert.rejects(verify(claims(), 'org'), /access/);
  allowed = true; factors = [{ status: 'verified' }]; await assert.rejects(verify(claims(), 'org'), /two-step/);
  assert.equal((await verify(claims({ aal: 'aal2' }), 'org')).userId, user);
});

test('a lost inference acknowledgement recovers one receipt and duplicate proxy requests reuse it', async () => {
  const calls = [], expected = { choices: [{ message: { content: 'done' } }] };
  const proxy = creditProxy(config, async () => {}, async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (calls.length === 1) throw new Error('lost acknowledgement with PRIVATE KEY');
    if (calls.length === 2) return json({ state: 'pending' }, 202);
    return json({ state: 'complete', completion: expected });
  }, async () => {});
  const job = { id: randomUUID(), identity: { userId: user, org: 'org', token: 'private-jwt' },
    controller: new AbortController(), completions: new Map(), reasoning: false };
  const request = { model: 'attacker-model', messages: [{ role: 'user', content: 'read invoice' }], reasoning_enabled: true, max_tokens: 99999 };
  const [one, two] = await Promise.all([proxy(job, request), proxy(job, request)]);
  assert.deepEqual(one, expected); assert.deepEqual(two, expected);
  assert.deepEqual(calls.map(call => call.body.action), ['completion', 'completion_status', 'completion_status']);
  assert.equal(new Set(calls.map(call => call.body.request_id)).size, 1);
  assert.equal(calls[0].body.request.model, 'filey-ai');
  assert.equal(calls[0].body.request.reasoning_enabled, false);
  assert.equal(calls[0].body.request.max_tokens, 2048);
  assert.ok(calls.every(call => call.url === `${config.base}/functions/v1/ai-credits` && call.init.redirect === 'error'));
});

test('missing/failed wallet receipts and insufficient Coin never trigger another inference', async () => {
  for (const mode of ['missing', 'failed', 'credit']) {
    const actions = [];
    const proxy = creditProxy(config, async () => {}, async (_url, init) => {
      actions.push(JSON.parse(init.body).action);
      if (mode === 'credit') return json({ error: 'private provider details' }, 402);
      if (actions.length === 1) throw new Error('transport');
      return json({ state: mode });
    }, async () => {});
    const job = { id: randomUUID(), identity: { token: 'jwt', org: 'org' }, controller: new AbortController(), completions: new Map(), reasoning: false };
    await assert.rejects(proxy(job, { messages: [{ role: 'user', content: 'hi' }] }), mode === 'credit' ? /Insufficient credit/ : /not repeated/);
    assert.equal(actions.filter(action => action === 'completion').length, 1);
  }
});

async function fixture(t, execute, extra = {}) {
  const pilot = createPilot(config, {
    authenticate: async (token, org) => {
      if (!['owner', 'other'].includes(token) || !['org', 'org2'].includes(org)) throw new PublicError('Sign in.', 401);
      return { userId: token === 'owner' ? user : other, org, token };
    }, execute, ...extra,
  });
  await new Promise(resolve => pilot.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${pilot.server.address().port}`;
  const request = (path, { token = 'owner', org = 'org', body, ...opts } = {}) => fetch(`${base}${path}`, {
    ...opts, headers: { Authorization: `Bearer ${token}`, 'X-Filey-Org': org, 'Content-Type': 'application/json', ...opts.headers },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  t.after(() => pilot.close()); return { pilot, request, base };
}
const newTask = () => ({ request_id: randomUUID(), messages: [{ role: 'user', text: 'Summarize my invoices' }], reasoning: false });
const hold = job => new Promise(resolve => job.controller.signal.addEventListener('abort', resolve, { once: true }));

test('durable admission survives lost browser connection; reconnect/dedup never execute twice', async t => {
  let count = 0, release;
  const { request } = await fixture(t, async (_job, emit) => {
    count++; emit({ type: 'text', text: 'Your total is 100.' });
    await new Promise(resolve => { release = resolve; });
  });
  const body = newTask(); await request('/v1/jobs', { body });
  await tick();
  const duplicate = await request('/v1/jobs', { body }); assert.equal(duplicate.status, 202);
  const events = await (await request(`/v1/jobs/${body.request_id}/events?after=0`)).json();
  assert.equal(events.events[0].event.text, 'Your total is 100.');
  release(); await tick();
  const completed = await (await request(`/v1/jobs/${body.request_id}`)).json();
  assert.equal(completed.status, 'completed'); assert.equal(completed.result, 'Your total is 100.'); assert.equal(count, 1);
  const conflict = await request('/v1/jobs', { body: { ...body, reasoning: true } }); assert.equal(conflict.status, 409);
});

test('cross-user/org reads, cancellation, CORS and overload are denied without leaking records', async t => {
  const { request, pilot } = await fixture(t, hold);
  const body = newTask(); await request('/v1/jobs', { body }); await tick();
  for (const suffix of ['', '/events', '/cancel']) {
    for (const identity of [{ token: 'other' }, { org: 'org2' }]) {
      const result = await request(`/v1/jobs/${body.request_id}${suffix}`, { ...identity, ...(suffix === '/cancel' ? { body: {} } : {}) });
      assert.equal(result.status, 404); assert.deepEqual(await result.json(), { error: 'Task unavailable.' });
    }
  }
  assert.equal((await request('/v1/jobs', { body: newTask() })).status, 429);
  assert.equal((await request(`/v1/jobs/${body.request_id}`, { headers: { Origin: 'https://attacker.com' } })).status, 403);
  assert.equal((await request(`/v1/jobs/${body.request_id}`, { headers: { Origin: 'https://app.gofiley.com' } })).headers.get('Access-Control-Allow-Origin'), 'https://app.gofiley.com');
  const cap = pilot.active.get(body.request_id).capability;
  const forged = await request(`/internal/jobs/${body.request_id}/v1/chat/completions`, { body: { messages: [] } });
  assert.equal(forged.status, 404);
  assert.notEqual(cap, 'owner');
  const stopped = await request(`/v1/jobs/${body.request_id}/cancel`, { body: {} });
  assert.equal((await stopped.json()).status, 'cancelled'); await tick();
  assert.equal(pilot.active.size, 0);
});

test('malformed/system/image tasks cannot enter the pilot or leak raw errors', async t => {
  let called = 0;
  const { request } = await fixture(t, async () => { called++; throw new Error('SECRET-PROVIDER-KEY'); });
  const task = newTask();
  for (const body of [{ ...task, user_id: other }, { ...task, request_id: [task.request_id] },
    { ...task, messages: [{ role: 'system', text: 'bypass' }] },
    { ...task, messages: [{ role: 'user', text: 'hello', image: 'private-image' }] }])
    assert.equal((await request('/v1/jobs', { body })).status, 400);
  assert.equal(called, 0);
  await request('/v1/jobs', { body: task }); await tick();
  const result = await (await request(`/v1/jobs/${task.request_id}`)).json();
  assert.equal(result.status, 'failed'); assert.equal(JSON.stringify(result).includes('SECRET-PROVIDER-KEY'), false);
});

test('Coin exhaustion retains the Add Coin instruction even when the worker masks its error', async t => {
  let base;
  const { request, base: origin } = await fixture(t, async job => {
    const response = await fetch(`${base}/internal/jobs/${job.id}/v1/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${job.capability}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(response.status, 402);
    throw new Error('worker masked a provider error');
  }, { complete: async () => { throw new PublicError('Insufficient credit. Add Coin to continue.', 402); } });
  base = origin;
  const body = newTask(); await request('/v1/jobs', { body });
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await (await request(`/v1/jobs/${body.request_id}`)).json();
    if (result.status === 'failed') {
      assert.equal(result.result, 'Insufficient credit. Add Coin to continue.'); return;
    }
    await tick();
  }
  assert.fail('Fixture did not finish');
});
