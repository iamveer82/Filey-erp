import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPilot } from './server.mjs';
import { JobStore } from './store.mjs';
import { PublicError } from './config.mjs';
import { SandboxCleanupError } from './runner.mjs';

const owner = '11111111-1111-4111-8111-111111111111', org = 'fictional-health-workspace';
const task = () => ({ request_id: randomUUID(), messages: [{ role: 'user', text: 'Read fictional invoice data' }], reasoning: false });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function eventually(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'fixture task did not settle promptly');
    await tick();
  }
}

/** In-memory encrypted storage, fictional authenticated identity and fake work.
 * These checks exercise actual HTTP admission, revocation and stored receipts. */
async function fixture(t, execute) {
  const store = new JobStore(':memory:', randomBytes(32));
  const saved = task();
  store.create(saved.request_id, owner, org, store.fingerprint(saved), saved);
  store.finish(saved.request_id, 'completed', 'Saved fictional reply');
  const unhandled = [];
  const listener = error => { unhandled.push(error); };
  process.on('unhandledRejection', listener);
  const config = { dbPath: ':memory:', origins: ['https://fictional.invalid'], concurrency: 2, perUser: 1,
    timeout: 1000, retention: 86_400_000 };
  const pilot = createPilot(config, { store, execute,
    authenticate: async (token, workspace) => {
      if (token !== 'fictional-owner-token' || workspace !== org) throw new PublicError('Sign in.', 401);
      return { userId: owner, org, token };
    }, complete: async () => { assert.fail('No model calls belong in runtime health checks'); },
  });
  await new Promise(resolve => pilot.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${pilot.server.address().port}`;
  const request = (path, body, token = 'fictional-owner-token') => fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Filey-Org': org, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  t.after(async () => {
    await pilot.close(); process.off('unhandledRejection', listener);
    assert.deepEqual(unhandled, [], 'runtime failures must never escape the queued task');
  });
  async function settled() { await eventually(() => pilot.active.size === 0); await tick(); }
  async function existingReadable() {
    const response = await request(`/v1/jobs/${saved.request_id}`);
    assert.equal(response.status, 200); assert.equal((await response.json()).result, 'Saved fictional reply');
    const replay = await request('/v1/jobs', saved);
    assert.equal(replay.status, 202); assert.equal((await replay.json()).result, 'Saved fictional reply');
  }
  async function newAdmissionBlocked() {
    const next = task(), response = await request('/v1/jobs', next);
    assert.equal(response.status, 503);
    const message = JSON.stringify(await response.json());
    assert.equal(message.includes('PRIVATE_STORAGE_DETAIL'), false);
    assert.equal(store.row(next.request_id), undefined);
  }
  function revoked(job) {
    assert.ok(job, 'captured task must have existed'); assert.equal(job.controller.signal.aborted, true);
    assert.equal(job.identity.token, ''); assert.equal(job.capability, '');
    assert.equal(pilot.active.size, 0); assert.deepEqual(unhandled, []);
  }
  return { store, pilot, request, saved, settled, existingReadable, newAdmissionBlocked, revoked };
}

test('running journal failure prevents work, revokes identity and preserves authenticated saved reads', async t => {
  let executions = 0, captured;
  const app = await fixture(t, async () => { executions++; });
  t.mock.method(app.store, 'running', id => { captured = app.pilot.active.get(id); throw new Error('PRIVATE_STORAGE_DETAIL'); });
  assert.equal((await app.request('/v1/jobs', task())).status, 202);
  await app.settled(); assert.equal(executions, 0); app.revoked(captured);
  await app.newAdmissionBlocked(); await app.existingReadable();
});

test('a lost finish persistence aborts work and old internal capability cannot make a model request', async t => {
  let captured, capability;
  const app = await fixture(t, async (job, emit) => { captured = job; capability = job.capability; emit({ type: 'text', text: 'Fictional partial reply' }); });
  t.mock.method(app.store, 'finish', () => { throw new Error('PRIVATE_STORAGE_DETAIL'); });
  const current = task(); assert.equal((await app.request('/v1/jobs', current)).status, 202);
  await app.settled(); app.revoked(captured);
  const response = await app.request(`/internal/jobs/${current.request_id}/v1/chat/completions`, { messages: [] }, capability);
  assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: 'Task unavailable.' });
  await app.newAdmissionBlocked(); await app.existingReadable();
});

test('output journal failure stops further work and never exposes private storage error details', async t => {
  let captured;
  const app = await fixture(t, async (job, emit) => { captured = job; emit({ type: 'text', text: 'Fictional output' }); });
  t.mock.method(app.store, 'event', () => { throw new Error('PRIVATE_STORAGE_DETAIL'); });
  const current = task(); assert.equal((await app.request('/v1/jobs', current)).status, 202);
  await app.settled(); app.revoked(captured);
  const receipt = await app.request(`/v1/jobs/${current.request_id}`);
  assert.equal(receipt.status, 200); assert.equal(JSON.stringify(await receipt.json()).includes('PRIVATE_STORAGE_DETAIL'), false);
  await app.newAdmissionBlocked(); await app.existingReadable();
});

test('pruning failure leaves the completed receipt readable, revokes credentials and blocks new work', async t => {
  let captured;
  const app = await fixture(t, async (job, emit) => { captured = job; emit({ type: 'text', text: 'Completed fictional reply' }); });
  t.mock.method(app.store, 'prune', () => { throw new Error('PRIVATE_STORAGE_DETAIL'); });
  const current = task(); assert.equal((await app.request('/v1/jobs', current)).status, 202);
  await app.settled(); app.revoked(captured);
  const receipt = await app.request(`/v1/jobs/${current.request_id}`);
  assert.equal(receipt.status, 200); assert.equal((await receipt.json()).result, 'Completed fictional reply');
  await app.newAdmissionBlocked(); await app.existingReadable();
});

test('uncertain sandbox cleanup disables admissions until operator recovery but keeps saved reads', async t => {
  let captured;
  const app = await fixture(t, async job => { captured = job; throw new SandboxCleanupError(); });
  const current = task(); assert.equal((await app.request('/v1/jobs', current)).status, 202);
  await app.settled(); app.revoked(captured);
  const receipt = await app.request(`/v1/jobs/${current.request_id}`);
  assert.equal(receipt.status, 200); assert.equal((await receipt.json()).status, 'failed');
  await app.newAdmissionBlocked(); await app.existingReadable();
});

test('ordinary provider failure remains generic and does not disable a later authorized task', async t => {
  let executions = 0;
  const app = await fixture(t, async (_job, emit) => {
    if (++executions === 1) throw new Error('PRIVATE_STORAGE_DETAIL');
    emit({ type: 'text', text: 'Next fictional task succeeded' });
  });
  const failed = task(); assert.equal((await app.request('/v1/jobs', failed)).status, 202); await app.settled();
  const failedReceipt = await (await app.request(`/v1/jobs/${failed.request_id}`)).json();
  assert.equal(failedReceipt.status, 'failed'); assert.equal(JSON.stringify(failedReceipt).includes('PRIVATE_STORAGE_DETAIL'), false);
  const fresh = task(); assert.equal((await app.request('/v1/jobs', fresh)).status, 202); await app.settled();
  const receipt = await (await app.request(`/v1/jobs/${fresh.request_id}`)).json();
  assert.equal(receipt.status, 'completed'); assert.equal(receipt.result, 'Next fictional task succeeded'); assert.equal(executions, 2);
});

test('conflicting duplicate UUID cannot globally disable admissions or replay the original task', async t => {
  let executions = 0;
  const app = await fixture(t, async (_job, emit) => { executions++; emit({ type: 'text', text: 'Fictional reply' }); });
  assert.equal((await app.request('/v1/jobs', { ...app.saved, reasoning: true })).status, 409);
  assert.equal(executions, 0);
  const fresh = task(); assert.equal((await app.request('/v1/jobs', fresh)).status, 202); await app.settled();
  assert.equal(executions, 1); assert.equal((await (await app.request(`/v1/jobs/${fresh.request_id}`)).json()).status, 'completed');
  await app.existingReadable(); assert.equal(executions, 1);
});
