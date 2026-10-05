import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { PublicError, TERMINAL } from './config.mjs';

/** One small durable journal. JWTs, provider credentials and capabilities never
 * enter it. Prompts/events/results are authenticated and encrypted per row. */
export class JobStore {
  constructor(path, key) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid encryption key');
    this.key = key;
    this.fingerprintKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'filey-hermes-fingerprint-v1', 32));
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      // An OS-backed SQLite lease is held on a separate empty file. It releases
      // on process death and prevents another instance from interrupting live
      // jobs. Keeping it separate allows normal journal transactions below.
      this.lease = new DatabaseSync(`${path}.lease`);
      try { chmodSync(`${path}.lease`, 0o600); this.lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE'); }
      catch { this.lease.close(); throw new Error('Another pilot process owns this journal, or it is unavailable.'); }
    }
    try {
      this.db = new DatabaseSync(path);
      if (path !== ':memory:') chmodSync(path, 0o600);
      this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, org TEXT NOT NULL,
        fingerprint TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL,
        payload BLOB NOT NULL, result BLOB, sequence INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        job TEXT NOT NULL REFERENCES jobs(id), sequence INTEGER NOT NULL,
        payload BLOB NOT NULL, PRIMARY KEY(job, sequence)
      );`);
      const existing = this.db.prepare('SELECT id,owner,org,payload FROM jobs LIMIT 1').get();
      if (existing) this.open(existing.id, existing.payload, existing);
      // A restart never replays inference or tools. Receipts remain reconnectable.
      for (const row of this.db.prepare("SELECT id FROM jobs WHERE status IN ('running','queued')").all()) {
        this.finish(row.id, 'interrupted', 'This task was interrupted. Review the saved reply before starting another task.');
      }
    } catch (error) { this.db?.close(); this.lease?.close(); throw error; }
  }
  fingerprint(value) { return createHmac('sha256', this.fingerprintKey).update(JSON.stringify(value)).digest('hex'); }
  seal(id, value, binding) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify([1, id, binding.owner, binding.org])));
    return Buffer.concat([nonce, ...this.encrypt(cipher, value)]);
  }
  encrypt(cipher, value) {
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return [cipher.getAuthTag(), body];
  }
  open(id, payload, binding) {
    const bytes = Buffer.from(payload), decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(JSON.stringify([1, id, binding.owner, binding.org]))); decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  }
  row(id) { return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id); }
  create(id, owner, org, fingerprint, payload) {
    const prior = this.row(id);
    if (prior) {
      if (prior.owner !== owner || prior.org !== org) throw new PublicError('Task unavailable.', 404);
      if (prior.fingerprint !== fingerprint) throw new PublicError('This task identifier belongs to a different request.', 409);
      return { created: false, row: prior };
    }
    this.db.prepare('INSERT INTO jobs(id,owner,org,fingerprint,status,created,payload) VALUES(?,?,?,?,?,?,?)')
      .run(id, owner, org, fingerprint, 'queued', Date.now(), this.seal(id, payload, { owner, org }));
    return { created: true, row: this.row(id) };
  }
  running(id) { this.db.prepare("UPDATE jobs SET status='running' WHERE id=? AND status='queued'").run(id); }
  event(id, event) {
    const row = this.row(id);
    if (!row || TERMINAL.has(row.status) || row.sequence >= 512) return false;
    const sequence = row.sequence + 1;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO events(job,sequence,payload) VALUES(?,?,?)').run(id, sequence, this.seal(`${id}:${sequence}`, event, row));
      this.db.prepare('UPDATE jobs SET sequence=? WHERE id=?').run(sequence, id);
      this.db.exec('COMMIT'); return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  finish(id, status, text) {
    const row = this.row(id);
    if (!row || TERMINAL.has(row.status)) return;
    const sequence = row.sequence + 1;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO events(job,sequence,payload) VALUES(?,?,?)').run(id, sequence,
        this.seal(`${id}:${sequence}`, { type: 'done', text, reason: status === 'completed' ? 'answered' : status === 'cancelled' ? 'stopped' : 'error' }, row));
      this.db.prepare('UPDATE jobs SET status=?,result=?,sequence=? WHERE id=?').run(status, this.seal(id, text, row), sequence, id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  view(row, after) {
    const result = row.result ? this.open(row.id, row.result, row) : undefined;
    this.open(row.id, row.payload, row);
    return {
      id: row.id, status: row.status, last_sequence: row.sequence, ...(result !== undefined ? { result } : {}),
      ...(after !== undefined ? { events: this.db.prepare('SELECT sequence,payload FROM events WHERE job=? AND sequence>? ORDER BY sequence LIMIT 128')
        .all(row.id, after).map(item => ({ sequence: item.sequence, event: this.open(`${row.id}:${item.sequence}`, item.payload, row) })) } : {}),
    };
  }
  prune(before) {
    this.db.prepare('DELETE FROM events WHERE job IN (SELECT id FROM jobs WHERE created<? AND status NOT IN (\'running\',\'queued\'))').run(before);
    this.db.prepare("DELETE FROM jobs WHERE created<? AND status NOT IN ('running','queued')").run(before);
  }
  close() { try { this.db.close(); } finally { this.lease?.close(); } }
}
