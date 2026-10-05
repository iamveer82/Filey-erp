import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { PublicError } from './config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runnerPath = fileURLToPath(new URL('../hermes/runner.py', import.meta.url));
const cleanEnv = () => Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const exec = promisify(execFile);
const dockerCall = args => exec('docker', args, { env: cleanEnv(), timeout: 15_000, maxBuffer: 64_000, windowsHide: true });

export async function sandboxNetwork(name, call = dockerCall) {
  await call(['network', 'create', '--internal', '--driver', 'bridge', name]);
  try {
    const { stdout } = await call(['network', 'inspect', name]);
    const networks = JSON.parse(stdout), network = networks[0];
    const gateway = network?.IPAM?.Config?.[0]?.Gateway;
    const bytes = typeof gateway === 'string' ? gateway.split('.').map(Number) : [];
    const privateGateway = isIP(gateway ?? '') === 4 &&
      (bytes[0] === 10 || bytes[0] === 192 && bytes[1] === 168 || bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31);
    if (networks.length !== 1 || network.Internal !== true || network.Driver !== 'bridge' || network.Name !== name || !privateGateway)
      throw new Error('Unsafe network');
    return { gateway, close: () => call(['network', 'rm', name]).catch(() => {}) };
  } catch { await call(['network', 'rm', name]).catch(() => {}); throw new PublicError('The isolated agent network is unavailable.', 503); }
}

/** The trusted MCP process owns the user's scoped JWT. The untrusted Hermes
 * process only receives a per-job capability for this read-only relay. */
export function mcpRelay(config, job) {
  const env = { ...cleanEnv(), FILEY_MCP_MODE: 'hermes-pilot',
    FILEY_HERMES_BINDING: JSON.stringify({ version: 1, user_id: job.identity.userId, org_id: job.identity.org, data_mode: 'cloud' }),
    SUPABASE_URL: config.base, SUPABASE_ANON_KEY: config.anonKey, SUPABASE_ACCESS_TOKEN: job.identity.token };
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../mcp-server/dist/index.js', import.meta.url))],
    { cwd: root, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const pending = new Map(); let nextId = 1, dead = false;
  const fail = () => { dead = true; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new PublicError('Record access is unavailable.', 503)); } pending.clear(); };
  child.on('error', fail); child.on('exit', fail);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (Buffer.byteLength(line) > 2_000_000) { child.kill(); fail(); return; }
    let data; try { data = JSON.parse(line); } catch { return; }
    const item = pending.get(data.id);
    if (item) { pending.delete(data.id); clearTimeout(item.timer); item.resolve({ ...data, id: item.original }); }
  });
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
    let network;
    if (!config.local) network = await sandboxNetwork(`filey-hermes-${job.id}`);
    const base = `http://${config.local ? '127.0.0.1' : network.gateway}:${config.port}`;
    const env = { FILEY_HERMES_PROXY_URL: `${base}/internal/jobs/${job.id}/v1`,
      FILEY_HERMES_MCP_URL: `${base}/internal/jobs/${job.id}/mcp`, FILEY_HERMES_PROXY_TOKEN: job.capability };
    let command, args, childEnv;
    if (config.local) {
      if (!config.python || !config.source) throw new PublicError('The development runner is not configured.', 503);
      command = config.python; args = ['-B', runnerPath];
      childEnv = { ...cleanEnv(), ...env, FILEY_HERMES_SOURCE_DIR: config.source, PYTHONIOENCODING: 'utf-8' };
    } else {
      command = 'docker';
      args = ['run', '--rm', '-i', '--name', `filey-hermes-${job.id}`, '--read-only', '--user', '10001:10001',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '768m', '--cpus', '1',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,mode=1777', '--network', `filey-hermes-${job.id}`,
        ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]), config.image];
      childEnv = cleanEnv();
    }
    if (job.controller.signal.aborted) { await network?.close(); throw new PublicError('Task stopped.', 409); }
    const child = spawn(command, args, { cwd: root, env: childEnv, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const stop = () => {
      child.kill();
      if (!config.local) spawn('docker', ['kill', `filey-hermes-${job.id}`], { env: cleanEnv(), stdio: 'ignore', windowsHide: true });
    };
    job.controller.signal.addEventListener('abort', stop, { once: true });
    const lines = createInterface({ input: child.stdout });
    let done = false, size = 0, bad = false, failure;
    lines.on('line', line => {
      size += Buffer.byteLength(line);
      if (size > 1_000_000 || Buffer.byteLength(line) > 262_144) { bad = true; stop(); return; }
      let event; try { event = JSON.parse(line); } catch { bad = true; stop(); return; }
      if (event.type === 'text' && typeof event.text === 'string' && !done) emit({ type: 'text', text: event.text });
      else if (event.type === 'done' && !done) { done = event.reason === 'complete'; if (!done) { bad = true; stop(); } }
      else if (event.type === 'error') {
        if (event.code === 'insufficient_credit') failure = new PublicError('Insufficient credit. Add Coin to continue.', 402);
        bad = true; stop();
      }
      else { bad = true; stop(); }
    });
    try {
      await new Promise((resolve, reject) => {
        child.once('error', () => reject(new PublicError('The isolated agent runner is unavailable.', 503)));
        child.once('close', code => code === 0 && done && !bad ? resolve() : reject(failure ?? new PublicError('The agent could not finish this task. Review any saved reply.', 503)));
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify({ messages: job.messages, reasoning: job.reasoning }));
      });
    } finally { lines.close(); job.controller.signal.removeEventListener('abort', stop); await network?.close(); }
  };
}
