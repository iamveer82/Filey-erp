import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { PublicError } from './config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runnerPath = fileURLToPath(new URL('../hermes/runner.py', import.meta.url));
const cleanEnv = () => Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const exec = promisify(execFile);
const dockerCall = args => exec('docker', args, { env: cleanEnv(), timeout: 15_000, maxBuffer: 64_000, windowsHide: true });

/** Enforce byte limits before buffering, including a child that never writes a
 * newline. Decode complete lines only so split UTF-8 codepoints stay intact. */
export function boundedLines(stream, maxBytes, onLine, onViolation, totalLimit = Infinity) {
  let parts = [], length = 0, total = 0, closed = false;
  const close = () => {
    closed = true; parts = []; length = 0;
    stream.off('data', data); stream.off('end', end);
  };
  const violate = () => { if (!closed) { close(); onViolation(); } };
  const flush = () => {
    const line = Buffer.concat(parts, length).toString('utf8').replace(/\r$/, '');
    parts = []; length = 0;
    try { onLine(line); } catch { violate(); }
  };
  const data = chunk => {
    if (closed) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > totalLimit) { violate(); return; }
    let start = 0;
    while (start < bytes.length && !closed) {
      const newline = bytes.indexOf(10, start), until = newline < 0 ? bytes.length : newline;
      const part = bytes.subarray(start, until);
      if (length + part.length > maxBytes) { violate(); return; }
      parts.push(part); length += part.length;
      if (newline < 0) return;
      flush(); start = newline + 1;
    }
  };
  const end = () => { if (!closed && length) flush(); close(); };
  stream.on('data', data); stream.on('end', end);
  return { close };
}

export class SandboxCleanupError extends PublicError {
  constructor() { super('The isolated agent cleanup could not be verified.', 503); }
}
async function removeNetwork(name, call) {
  try { await call(['network', 'rm', name]); }
  catch (error) {
    const detail = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    if (![ `Error response from daemon: network ${name} not found`,
      `Error response from daemon: No such network: ${name}`, `Error: No such network: ${name}` ].includes(detail)) throw new SandboxCleanupError();
  }
}
export async function sandboxCleanup(name, network, call = dockerCall) {
  try {
    try { await call(['container', 'rm', '--force', name]); }
    catch (error) {
      const detail = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
      // A completed --rm container or a failed creation is already absent.
      if (![ `Error response from daemon: No such container: ${name}`, `Error: No such container: ${name}` ].includes(detail)) throw error;
    }
    // Never race removal against an attached/running container.
    await network.close();
  } catch { throw new SandboxCleanupError(); }
}

export async function sandboxNetwork(name, call = dockerCall) {
  try {
    await call(['network', 'create', '--internal', '--driver', 'bridge', name]);
    const { stdout } = await call(['network', 'inspect', name]);
    const networks = JSON.parse(stdout), network = networks[0];
    const gateway = network?.IPAM?.Config?.[0]?.Gateway;
    const bytes = typeof gateway === 'string' ? gateway.split('.').map(Number) : [];
    const privateGateway = isIP(gateway ?? '') === 4 &&
      (bytes[0] === 10 || bytes[0] === 192 && bytes[1] === 168 || bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31);
    if (networks.length !== 1 || network.Internal !== true || network.Driver !== 'bridge' || network.Name !== name || !privateGateway)
      throw new Error('Unsafe network');
    return { gateway, close: () => removeNetwork(name, call) };
  } catch {
    await removeNetwork(name, call);
    throw new PublicError('The isolated agent network is unavailable.', 503);
  }
}

/** The trusted MCP process owns the user's scoped JWT. The untrusted Hermes
 * process only receives a per-job capability for this read-only relay. */
export function mcpRelay(config, job) {
  const env = { ...cleanEnv(), FILEY_MCP_MODE: 'hermes-pilot',
    FILEY_HERMES_BINDING: JSON.stringify({ version: 1, user_id: job.identity.userId, org_id: job.identity.org, data_mode: 'cloud' }),
    SUPABASE_URL: config.base, SUPABASE_ANON_KEY: config.anonKey, SUPABASE_ACCESS_TOKEN: job.identity.token };
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../mcp-server/dist/index.js', import.meta.url))],
    { cwd: root, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const pending = new Map(); let nextId = 1, dead = false, lines;
  const fail = () => { dead = true; lines?.close(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new PublicError('Record access is unavailable.', 503)); } pending.clear(); };
  child.on('error', fail); child.on('exit', fail);
  lines = boundedLines(child.stdout, 2_000_000, line => {
    let data; try { data = JSON.parse(line); } catch { return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { child.kill(); fail(); return; }
    const item = pending.get(data.id);
    if (item) { pending.delete(data.id); clearTimeout(item.timer); item.resolve({ ...data, id: item.original }); }
  }, () => { child.kill(); fail(); });
  return {
    async request(message) {
      if (dead || job.controller.signal.aborted) throw new PublicError('Task stopped.', 409);
      if (!message || message.jsonrpc !== '2.0' || !['initialize', 'ping', 'notifications/initialized', 'tools/list', 'tools/call'].includes(message.method))
        throw new PublicError('This operation is not available in the pilot.', 403);
      const id = message.id;
      if (message.method === 'notifications/initialized') {
        if (id !== undefined) throw new PublicError('Invalid notification.');
        child.stdin.write(`${JSON.stringify(message)}\n`); return null;
      }
      if (!(typeof id === 'number' || typeof id === 'string') || pending.size >= 4) throw new PublicError('Invalid tool request.');
      await job.authenticate();
      if (dead || job.controller.signal.aborted) throw new PublicError('Task stopped.', 409);
      if (pending.size >= 4) throw new PublicError('Too many tool requests.', 429);
      if (message.method === 'tools/call') {
        job.toolCalls = (job.toolCalls ?? 0) + 1;
        if (job.toolCalls > 18) throw new PublicError('The task reached its tool limit.', 429);
      }
      return new Promise((resolve, reject) => {
        const relayId = nextId++;
        const timer = setTimeout(() => { pending.delete(relayId); reject(new PublicError('Record access timed out.', 503)); }, 25_000);
        pending.set(relayId, { original: id, resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ ...message, id: relayId })}\n`, error => {
          if (error) { pending.delete(relayId); clearTimeout(timer); reject(new PublicError('Record access is unavailable.', 503)); }
        });
      });
    },
    close() { lines.close(); child.kill(); fail(); },
  };
}

export function processRunner(config) {
  return async (job, emit) => {
    const name = `filey-hermes-${job.id}`;
    let network, child, lines, stop;
    try {
      if (job.controller.signal.aborted) throw new PublicError('Task stopped.', 409);
      if (!config.local) network = await sandboxNetwork(name);
      const base = `http://${config.local ? '127.0.0.1' : network.gateway}:${config.port}`;
      const env = { FILEY_HERMES_PROXY_URL: `${base}/internal/jobs/${job.id}/v1`,
        FILEY_HERMES_MCP_URL: `${base}/internal/jobs/${job.id}/mcp`, FILEY_HERMES_PROXY_TOKEN: job.capability };
      let command, args, childEnv;
      if (config.local) {
        if (!config.python || !config.source) throw new PublicError('The development runner is not configured.', 503);
        command = config.python; args = ['-B', runnerPath];
        childEnv = { ...cleanEnv(), ...env, FILEY_HERMES_SOURCE_DIR: config.source, PYTHONIOENCODING: 'utf-8' };
      } else {
        // Finish creation before attaching/start. Cancellation can then remove a
        // known container instead of racing an in-flight docker run creation.
        await dockerCall(['container', 'create', '--interactive', '--name', name, '--read-only', '--user', '10001:10001',
          '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '768m', '--cpus', '1',
          '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,mode=1777', '--network', name,
          ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]), config.image]);
        command = 'docker'; args = ['container', 'start', '--attach', '--interactive', name]; childEnv = cleanEnv();
      }
      if (job.controller.signal.aborted) throw new PublicError('Task stopped.', 409);
      child = spawn(command, args, { cwd: root, env: childEnv, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      stop = () => { lines?.close(); child.kill(); };
      job.controller.signal.addEventListener('abort', stop, { once: true });
      let done = false, bad = false, failure;
      lines = boundedLines(child.stdout, 262_144, line => {
        let event; try { event = JSON.parse(line); } catch { bad = true; stop(); return; }
        if (!event || typeof event !== 'object' || Array.isArray(event)) { bad = true; stop(); return; }
        if (event.type === 'text' && typeof event.text === 'string' && !done) {
          try { emit({ type: 'text', text: event.text }); } catch { bad = true; stop(); }
        } else if (event.type === 'done' && !done) { done = event.reason === 'complete'; if (!done) { bad = true; stop(); } }
        else if (event.type === 'error') {
          if (event.code === 'insufficient_credit') failure = new PublicError('Insufficient credit. Add Coin to continue.', 402);
          bad = true; stop();
        } else { bad = true; stop(); }
      }, () => { bad = true; stop(); }, 1_000_000);
      await new Promise((resolve, reject) => {
        child.once('error', () => reject(new PublicError('The isolated agent runner is unavailable.', 503)));
        child.once('close', code => code === 0 && done && !bad ? resolve() : reject(failure ?? new PublicError('The agent could not finish this task. Review any saved reply.', 503)));
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify({ messages: job.messages, reasoning: job.reasoning }));
      });
    } finally {
      lines?.close();
      if (stop) job.controller.signal.removeEventListener('abort', stop);
      if (network) await sandboxCleanup(name, network);
    }
  };
}
