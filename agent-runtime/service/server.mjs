import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { configuration, PublicError, UUID, TERMINAL } from './config.mjs';
import { JobStore } from './store.mjs';
import { authenticator } from './auth.mjs';
import { creditProxy } from './credits.mjs';
import { mcpRelay, processRunner, SandboxCleanupError } from './runner.mjs';

async function jsonBody(request, limit) {
  let size = 0, chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new PublicError('Request is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new PublicError('Use a valid JSON request.'); }
}
function taskBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['request_id', 'messages', 'reasoning'].includes(key)) ||
      typeof body.request_id !== 'string' || !UUID.test(body.request_id) || typeof body.reasoning !== 'boolean' ||
      !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 30 ||
      body.messages.some(item => !item || Object.keys(item).some(key => !['role', 'text'].includes(key)) ||
        !['user', 'assistant'].includes(item.role) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 16_000) ||
      body.messages.at(-1).role !== 'user') throw new PublicError('Use a valid text conversation.');
  return { request_id: body.request_id.toLowerCase(), messages: body.messages.map(item => ({ role: item.role, text: item.text })), reasoning: body.reasoning };
}

export function createPilot(config, options = {}) {
  const store = options.store ?? new JobStore(config.dbPath, config.encryptionKey);
  const authenticate = options.authenticate ?? authenticator(config);
  const complete = options.complete ?? creditProxy(config, authenticate);
  const execute = options.execute ?? processRunner(config);
  const relay = options.relay ?? mcpRelay;
  const active = new Map(); let closing = false, unavailable = false;
  const reply = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
  const persist = operation => {
    try { return operation(); }
    catch (error) {
      if (error instanceof PublicError) throw error;
      unavailable = true; throw new PublicError('The agent journal is temporarily unavailable. Reconnect shortly.', 503);
    }
  };
  const finish = (job, status, text) => {
    try { persist(() => store.finish(job.id, status, text)); }
    finally { job.controller.abort(); }
  };
  async function run(job) {
    const timer = setTimeout(() => {
      try { finish(job, 'interrupted', 'The task timed out. Review your saved reply before starting another task.'); }
      catch { /* persist already stopped admission; abort happened even on disk failure. */ }
    }, config.timeout);
    let text = '';
    try {
      persist(() => store.running(job.id));
      await job.authenticate();
      await execute(job, event => {
        if (event.type !== 'text' || typeof event.text !== 'string' || job.controller.signal.aborted) return;
        text += event.text;
        if (Buffer.byteLength(text) > 500_000 || !persist(() => store.event(job.id, event)))
          finish(job, 'interrupted', 'The task reached its output limit. Review your saved reply.');
      });
      if (!job.controller.signal.aborted) {
        await job.authenticate();
        finish(job, 'completed', text.trim() || 'The agent did not produce a reply.');
      }
    } catch (error) {
      if (error instanceof SandboxCleanupError) unavailable = true;
      if (!job.controller.signal.aborted) finish(job, 'failed', job.failure ?? (error instanceof PublicError ? error.message : 'The task could not finish. Review any saved reply before starting another task.'));
    } finally {
      clearTimeout(timer); job.mcp?.close(); active.delete(job.id);
      job.identity.token = ''; job.capability = '';
      persist(() => store.prune(Date.now() - config.retention));
    }
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const internal = /^\/internal\/jobs\/([0-9a-f-]+)\/(mcp|v1\/chat\/completions)$/.exec(url.pathname);
      if (internal) {
        const job = active.get(internal[1]), token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!job || token.length !== job.capability.length || !timingSafeEqual(Buffer.from(token), Buffer.from(job.capability)))
          throw new PublicError('Task unavailable.', 404);
        if (job.controller.signal.aborted || req.method !== 'POST') throw new PublicError('Task stopped.', 409);
        if (internal[2] === 'mcp') {
          const body = await jsonBody(req, 128_000);
          job.mcp ??= relay(config, job);
          const response = await job.mcp.request(body);
          reply(res, 200, response ?? {});
        } else {
          try { reply(res, 200, await complete(job, await jsonBody(req, 1_000_000))); }
          catch (error) {
            if (error instanceof PublicError && error.message === 'Insufficient credit. Add Coin to continue.')
              job.failure = 'Insufficient credit. Add Coin to continue.';
            throw error;
          }
        }
        return;
      }
      // Internal capabilities are never available to browser CORS requests.
      const origin = req.headers.origin;
      if (origin && !config.origins.includes(origin)) throw new PublicError('Origin unavailable.', 403);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Filey-Org');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (closing) throw new PublicError('The agent is restarting. Reconnect shortly.', 503);
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!token) throw new PublicError('Sign in to Filey.', 401);
      const identity = await authenticate(token, req.headers['x-filey-org']);
      if (url.pathname === '/v1/jobs' && req.method === 'POST') {
        const body = taskBody(await jsonBody(req, 64_000));
        const fingerprint = store.fingerprint(body);
        const prior = store.row(body.request_id);
        if (!prior && unavailable) throw new PublicError('The agent is temporarily unavailable. Reconnect to your saved task.', 503);
        if (!prior && (active.size >= config.concurrency || [...active.values()].filter(job => job.identity.userId === identity.userId).length >= config.perUser))
          throw new PublicError('Another task is running. Reconnect to it before starting a new task.', 429);
        const admitted = persist(() => store.create(body.request_id, identity.userId, identity.org, fingerprint, body));
        if (admitted.created) {
          const job = { id: body.request_id, identity, messages: body.messages, reasoning: body.reasoning,
            controller: new AbortController(), capability: randomBytes(32).toString('base64url'), completions: new Map() };
          job.authenticate = () => authenticate(job.identity.token, job.identity.org);
          active.set(job.id, job);
          // Admission is durable before acknowledgement, and browser disconnection
          // never cancels work. A duplicate POST returns this same journal entry.
          queueMicrotask(() => { void run(job).catch(() => { unavailable = true; }); });
        }
        reply(res, 202, store.view(store.row(body.request_id))); return;
      }
      const route = /^\/v1\/jobs\/([0-9a-f-]+)(\/events|\/cancel)?$/.exec(url.pathname);
      if (!route || !UUID.test(route[1])) throw new PublicError('Task unavailable.', 404);
      const row = store.row(route[1]);
      if (!row || row.owner !== identity.userId || row.org !== identity.org) throw new PublicError('Task unavailable.', 404);
      if (route[2] === '/cancel' && req.method === 'POST') {
        const job = active.get(row.id);
        if (job && !TERMINAL.has(row.status)) finish(job, 'cancelled', 'Task stopped. Work already performed can still use Coin.');
        reply(res, 200, store.view(store.row(row.id))); return;
      }
      if (req.method !== 'GET' || route[2] === '/cancel') throw new PublicError('Use GET.', 405);
      const after = route[2] === '/events' ? Number(url.searchParams.get('after') ?? 0) : undefined;
      if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) throw new PublicError('Invalid event cursor.');
      reply(res, 200, store.view(row, after));
    } catch (error) { if (!res.headersSent) reply(res, error instanceof PublicError ? error.status : 503,
      { error: error instanceof PublicError ? error.message : 'The agent is temporarily unavailable.' }); else res.destroy(); }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  server.maxRequestsPerSocket = 100;
  return { server, store, active,
    async close() {
      closing = true;
      for (const job of active.values()) {
        try { finish(job, 'interrupted', 'The agent restarted. Review the saved reply before starting another task.'); }
        catch { /* Still cancel and revoke the task if the journal cannot be written. */ }
        job.mcp?.close();
      }
      await new Promise(resolve => server.close(resolve));
      while (active.size) await new Promise(resolve => setTimeout(resolve, 10));
      store.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = configuration(), pilot = createPilot(config);
  pilot.server.listen(config.port, config.host, () => process.stdout.write('Filey Hermes pilot listening. Default app runtime remains unchanged.\n'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void pilot.close().then(() => process.exit(0)); });
}
