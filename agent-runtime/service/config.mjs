import { resolve } from 'node:path';

export class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
export function workspace(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 &&
    !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
export function configuration(env = process.env) {
  const port = Number(env.FILEY_HERMES_PORT ?? 16472);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid pilot port');
  const base = new URL(env.SUPABASE_URL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new Error('Use the configured HTTPS Supabase origin');
  const key = env.SUPABASE_ANON_KEY ?? '';
  if (key.startsWith('sb_secret_')) throw new Error('Pilot requires a publishable/anon key');
  if (!key.startsWith('sb_publishable_')) {
    try { if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role !== 'anon') throw new Error(); }
    catch { throw new Error('Pilot requires a publishable/anon key'); }
  }
  const encryptionKey = Buffer.from(env.FILEY_HERMES_DATA_KEY ?? '', 'base64');
  if (encryptionKey.length !== 32) throw new Error('Set an independent 32-byte base64 job encryption key');
  const origins = (env.FILEY_HERMES_ALLOWED_ORIGINS ?? 'http://127.0.0.1:1420').split(',').map(value => value.trim());
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')))
      throw new Error('Explicit HTTPS or loopback browser origins required');
  }
  // Local execution is a development-only escape hatch, never a remote service.
  const local = env.FILEY_HERMES_DEV_LOCAL === '1';
  if (local && env.NODE_ENV === 'production') throw new Error('Local runner forbidden in production');
  if (!local && !/^sha256:[a-f0-9]{64}$/.test(env.FILEY_HERMES_IMAGE_DIGEST ?? ''))
    throw new Error('A reviewed sandbox image digest is required');
  if (!local && env.FILEY_HERMES_BIND_ADDRESS !== '0.0.0.0')
    throw new Error('Configure a private relay listener behind a TLS reverse proxy and host firewall');
  return {
    port, host: local ? '127.0.0.1' : (env.FILEY_HERMES_BIND_ADDRESS ?? '127.0.0.1'), base: base.origin, anonKey: key, encryptionKey, origins,
    dbPath: resolve(env.FILEY_HERMES_DB ?? 'output/hermes-jobs.db'),
    local, python: env.FILEY_HERMES_PYTHON, source: env.FILEY_HERMES_SOURCE_DIR,
    image: env.FILEY_HERMES_IMAGE_DIGEST,
    concurrency: 2, perUser: 1, timeout: 300_000, retention: 24 * 60 * 60_000,
  };
}
