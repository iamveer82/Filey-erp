import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const handlers = {};
const stored = new Map();
const cache = {
  match: async request => stored.get(request.url ?? request),
  put: async (request, response) => stored.set(request.url ?? request, response),
};
let network = 0;
let status = 200;
const response = () => ({ ok: status === 200, type: 'basic', status, clone: response });
runInNewContext(readFileSync('public/sw.js', 'utf8'), {
  URL,
  self: { location: { origin: 'https://app.test' }, addEventListener: (type, handler) => { handlers[type] = handler; } },
  caches: { open: async () => cache },
  fetch: async () => { network++; return response(); },
});
async function request(path, mode = 'cors') {
  let result;
  handlers.fetch({ request: { url: new URL(path, 'https://app.test').href, method: 'GET', mode }, respondWith: promise => { result = promise; } });
  return result;
}
await request('/assets/index-Abc12345.js');
await request('/assets/index-Abc12345.js');
assert.equal(network, 1, 'immutable assets should be served locally after the first load');
await request('/', 'navigate');
await request('/', 'navigate');
assert.equal(network, 3, 'HTML must check for new deployments');
const saved = stored.get('https://app.test/');
status = 503;
await request('/', 'navigate');
assert.equal(stored.get('https://app.test/'), saved, 'errors must not overwrite the offline shell');
assert.equal(await request('/api/private'), undefined);
assert.equal(await request('https://cloud.test/rest/v1/invoices'), undefined);
assert.equal(await request('/assets/index-Abc12345.js?token=private'), undefined);
assert.equal(network, 4, 'API responses must never enter the service-worker cache');
console.log('Service-worker asset, HTML, error and private-response checks passed.');
