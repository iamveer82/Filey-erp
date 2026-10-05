/** Fictional end-to-end pilot: real job service, Hermes core, relay and MCP child.
 * Only loopback fixtures are contacted; no deployed credentials or paid inference. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPilot } from './server.mjs';

const python = process.env.FILEY_HERMES_TEST_PYTHON;
const source = process.env.FILEY_HERMES_TEST_SOURCE_DIR;
const image = process.env.FILEY_HERMES_TEST_IMAGE;
const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const org = 'fictional-hermes-workspace';
const jwt = claims => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
  Buffer.from(JSON.stringify(claims)).toString('base64url'), 'fictional-fixture-signature'].join('.');
const userToken = jwt({ sub: owner, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 });
const anon = jwt({ role: 'anon' });
const expectedTools = ['get_financial_summary', 'list_invoices', 'get_invoice', 'list_quotes', 'list_orders',
  'list_purchase_orders', 'list_customers', 'find_customer', 'list_products', 'list_low_stock', 'run_report'];
const allModules = ['accounting', 'invoicing', 'inventory', 'quoting', 'orders', 'purchase-orders', 'customers', 'reports'];
const reasoning = 'Fictional private reasoning: read the current invoice with the reviewed tool.';
const finalText = 'Invoice DEMO-001 for Mark totals AED 120.';

test('actual Hermes job reads a bound invoice, preserves private reasoning and replays one durable result', {
  skip: !image && (!python || !source) ? 'Set the isolated Python/source paths or a reviewed sandbox image for the offline real-core smoke' : false,
  timeout: 180_000,
}, async t => {
  if (image) assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const state = { completions: [], backendHeaders: [], internalHeaders: [], reads: [], writes: 0, inferenceIds: new Set() };
  const fixture = createServer(async (request, response) => {
    const reply = (data, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      assert.equal(request.headers.authorization, `Bearer ${userToken}`);
      assert.equal(request.headers.apikey, anon);
      if (url.pathname === '/auth/v1/user')
        return reply({ id: owner, role: 'authenticated', email_confirmed_at: '2026-01-01T00:00:00Z' });
      if (url.pathname === '/rest/v1/profiles') {
        assert.equal(url.searchParams.get('id'), `eq.${owner}`);
        const profile = { id: owner, org_id: org };
        return reply(request.headers.accept?.includes('application/vnd.pgrst.object+json') ? profile : [profile]);
      }
      if (url.pathname === '/rest/v1/rpc/filey_module_access')
        return reply({ allowed: true, admin: false, modules: allModules });
      if (url.pathname === '/functions/v1/ai-credits') {
        state.backendHeaders.push({ ...request.headers });
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw);
        assert.equal(body.action, 'completion', 'this acknowledged fixture needs no inference recovery');
        assert.equal(body.funding, 'credits');
        assert.equal(body.recoverable, true);
        assert.equal(body.org_id, org);
        assert.equal(body.request.model, 'filey-ai');
        assert.equal(body.request.reasoning_enabled, true);
        assert.equal(raw.includes(userToken), false, 'user credential is not model context');
        assert.equal(state.inferenceIds.has(body.request_id), false, 'each tool round has one paid request identity');
        state.inferenceIds.add(body.request_id);
        state.completions.push(body);
        assert.deepEqual(body.request.tools.map(tool => tool.function.name).sort(), expectedTools.map(name => `mcp__filey__${name}`).sort());
        let message, finish;
        if (state.completions.length === 1) {
          message = { role: 'assistant', content: null, reasoning_content: reasoning, tool_calls: [{
            id: 'fictional-read-invoices', type: 'function', function: { name: 'mcp__filey__list_invoices', arguments: '{}' },
          }] };
          finish = 'tool_calls';
        } else {
          assert.equal(state.completions.length, 2, 'one read round and one final answer');
          const assistant = body.request.messages.find(item => item.tool_calls);
          assert.equal(assistant.reasoning_content, reasoning, 'actual Hermes replays supplier reasoning verbatim');
          const tool = body.request.messages.find(item => item.role === 'tool');
          assert.ok(tool, 'the second inference contains an actual MCP result');
          assert.match(JSON.stringify(tool.content), /DEMO-001/);
          assert.match(JSON.stringify(tool.content), /120/);
          assert.equal(JSON.stringify(tool.content).includes('OTHER-PRIVATE'), false);
          message = { role: 'assistant', content: finalText, reasoning_content: 'Fictional private final reasoning.' };
          finish = 'stop';
        }
        return reply({ state: 'complete', completion: { id: `fictional-${state.completions.length}`, object: 'chat.completion',
          created: 1, model: 'filey-ai', choices: [{ index: 0, message, finish_reason: finish }],
          usage: { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 } } });
      }
      if (request.method !== 'GET') { state.writes++; return reply({ error: 'Fixture writes are forbidden' }, 403); }
      assert.equal(url.searchParams.get('org_id'), `eq.${org}`, 'every business read is workspace bound');
      state.reads.push(url.pathname);
      if (url.pathname === '/rest/v1/invoice_docs') {
        const invoices = [
          { id: 'fictional-invoice', user_id: owner, org_id: org, number: 'DEMO-001', customer_name: 'Mark',
            status: 'draft', doc_type: null, currency: 'AED', tax_rate: 0, discount: 0, round_off: false, issue_date: '2026-01-01' },
          { id: 'other-invoice', user_id: other, org_id: org, number: 'OTHER-PRIVATE', customer_name: 'Other private customer' },
        ];
        return reply(invoices.filter(invoice => invoice.user_id === owner && invoice.org_id === org));
      }
      if (url.pathname === '/rest/v1/invoice_doc_items') {
        assert.equal(url.searchParams.get('invoice_id'), 'in.(fictional-invoice)');
        return reply([{ invoice_id: 'fictional-invoice', description: 'Fictional demo item', qty: 2, unit_price: 60, position: 0, custom: {} }]);
      }
      return reply([]);
    } catch (error) {
      state.failure ??= error;
      reply({ error: 'Fictional fixture contract failed' }, 500);
    }
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const config = { dbPath: ':memory:', encryptionKey: randomBytes(32), origins: ['http://127.0.0.1:1420'],
    base: `http://127.0.0.1:${fixture.address().port}`, anonKey: anon,
    local: !image, image, python, source, concurrency: 2, perUser: 1, timeout: 150_000, retention: 86_400_000 };
  const pilot = createPilot(config);
  pilot.server.on('request', request => {
    if (request.url.startsWith('/internal/jobs/')) state.internalHeaders.push({ ...request.headers });
  });
  await new Promise(resolve => pilot.server.listen(0, image ? '0.0.0.0' : '127.0.0.1', resolve));
  config.port = pilot.server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  t.after(async () => {
    await pilot.close();
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
  });
  const call = (path, body) => fetch(base + path, { headers: { Authorization: `Bearer ${userToken}`,
    'X-Filey-Org': org, 'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const request = { request_id: randomUUID(), messages: [{ role: 'user', text: 'Check my invoices for Mark.' }], reasoning: true };
  const submitted = await call('/v1/jobs', request);
  assert.equal(submitted.status, 202);
  let result;
  const started = Date.now();
  do {
    await new Promise(resolve => setTimeout(resolve, 200));
    const response = await call(`/v1/jobs/${request.request_id}`);
    assert.equal(response.status, 200);
    result = await response.json();
    if (state.failure) throw state.failure;
  } while (['running', 'queued'].includes(result.status) && Date.now() - started < 155_000);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.result, finalText);
  const events = await (await call(`/v1/jobs/${request.request_id}/events?after=0`)).json();
  assert.deepEqual(events.events.map(item => item.event.type), ['text', 'done']);
  assert.equal(JSON.stringify(events).includes(reasoning), false);
  assert.equal(JSON.stringify(events).includes(userToken), false);
  assert.equal(state.completions.length, 2);
  assert.equal(state.writes, 0);
  assert.ok(state.reads.includes('/rest/v1/invoice_docs'));
  assert.ok(state.reads.includes('/rest/v1/invoice_doc_items'));
  assert.ok(state.internalHeaders.length > 2);
  for (const headers of state.internalHeaders) {
    assert.notEqual(headers.authorization, `Bearer ${userToken}`, 'Hermes receives only its job capability');
    assert.equal(headers.apikey, undefined, 'Supabase public key also stays in the trusted parent');
    assert.equal(JSON.stringify(headers).includes(userToken), false);
  }
  assert.ok(state.backendHeaders.every(headers => headers.authorization === `Bearer ${userToken}`), 'only the trusted billing adapter uses user auth');
  const replay = await call('/v1/jobs', request);
  assert.equal(replay.status, 202);
  assert.equal((await replay.json()).result, finalText);
  assert.equal((await (await call(`/v1/jobs/${request.request_id}`)).json()).result, finalText);
  assert.equal(state.completions.length, 2, 'POST/GET receipt replay never starts another inference');
});
