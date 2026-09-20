// Compare a read-only Supabase catalog export with the checked-out application.
// Usage: node scripts/check-cloud-schema.mjs output/cloud-audit/runtime-schema.json
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const raw = readFileSync(process.argv[2], 'utf8');
const catalog = JSON.parse(raw.slice(raw.indexOf('{'))).rows[0].catalog;
const files = root => readdirSync(root, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]);
const text = file => readFileSync(file, 'utf8');
const functions = new Map(catalog.functions.map(f => [f.name, f]));
const columns = new Set(catalog.columns.map(c => `${c.table}.${c.column}`));
const tables = new Map(catalog.tables.map(t => [t.table, t]));
const issues = new Set();

// Static RPC names cover every current frontend/edge caller. Computed names
// would need an explicit assertion here; none are inferred from arbitrary text.
for (const file of [...files('src'), ...files('supabase/functions')]
  .filter(file => /\.(ts|tsx)$/.test(file) && !file.includes('.test.'))) {
  for (const match of text(file).matchAll(/\.rpc\(\s*["'`]([\w]+)["'`]/g))
    if (!functions.has(match[1])) issues.add(`Missing RPC: ${match[1]}`);
}
// Feature migrations include explicit ADD COLUMN declarations, while CREATE
// declarations cover the original fields. This is a drift check, not a SQL parser.
for (const file of files('supabase').filter(file => file.endsWith('.sql') && !/[\\/]tests[\\/]|verify-/.test(file))) {
  const sql = text(file);
  for (const match of sql.matchAll(/alter\s+table\s+(?:if exists\s+)?(?:public\.)?(\w+)\s+add\s+column\s+(?:if not exists\s+)?(\w+)/gi))
    if (!columns.has(`${match[1]}.${match[2]}`)) issues.add(`Missing column: ${match[1]}.${match[2]}`);
  for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    if (!tables.has(match[1])) issues.add(`Missing table: ${match[1]}`);
    for (const line of match[2].split('\n')) {
      const column = line.trim().match(/^([a-z_]+)\s+(?:text|bigint|integer|numeric|boolean|uuid|jsonb|timestamptz|date|time|int|bigserial|serial)(?:\W|$)/i);
      if (column && !columns.has(`${match[1]}.${column[1]}`)) issues.add(`Missing column: ${match[1]}.${column[1]}`);
    }
  }
}
const syncTables = [...text('src/lib/syncTables.ts').matchAll(/^\s+"(\w+)",?$/gm)].map(match => match[1]);
assert.equal(syncTables.length, 45, 'Review the manifest RPC allowlist when adding sync tables');
for (const table of syncTables) {
  if (!tables.get(table)?.rls) issues.add(`Missing RLS: ${table}`);
  if (!columns.has(`${table}.sync_revision`)) issues.add(`Missing sync revision: ${table}`);
  if (!catalog.triggers.some(t => t.table === table && t.name === 'sync_revision' && t.enabled !== 'D'))
    issues.add(`Missing revision trigger: ${table}`);
  if (!catalog.publication.includes(table)) issues.add(`Missing Realtime publication: ${table}`);
}
for (const f of functions.values()) {
  if (f.definer && !f.config?.some(setting => setting.startsWith('search_path=')))
    issues.add(`Unpinned SECURITY DEFINER: ${f.name}`);
}
for (const name of ['sync_record','filey_sync_manifest','filey_take_rate_limit','filey_apply_dodo_subscription','filey_prepare_invitation'])
  if (functions.get(name)?.anon) issues.add(`Unexpected anonymous RPC access: ${name}`);
console.log(JSON.stringify({ tables: tables.size, columns: columns.size, functions: functions.size, issues: [...issues] }, null, 2));
if (issues.size) process.exitCode = 1;
