// Disposable PostgreSQL: no Supabase credentials or customer records.
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.env.PGBIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim());
const temp = mkdtempSync(join(tmpdir(), 'filey-channel-'));
const run = (name, args, input) => execFileSync(join(bin, name + (process.platform === 'win32' ? '.exe' : '')), args, { input, encoding: 'utf8', windowsHide: true, stdio: name === 'pg_ctl' ? 'ignore' : ['pipe', 'pipe', 'pipe'] });
const server = createServer();
await new Promise(done => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
await new Promise(done => server.close(done));
let started = false;
try {
  run('initdb', ['-D', temp, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  run('pg_ctl', ['-D', temp, '-l', join(temp, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}${process.platform === 'win32' ? '' : ` -k "${temp}"`}`, '-w', 'start']);
  started = true;
  const migration = readFileSync(join(root, 'supabase/2026-09-30-channel-agent-drafts.sql'), 'utf8');
  const setup = `
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
    create table profiles(id uuid primary key,org_id text);
    create table org_members(user_id uuid,org_id text,role text,primary key(user_id,org_id));
    create table suppliers(id bigint generated always as identity primary key,org_id text,name text);
    create table invoice_docs(id bigint generated always as identity primary key,user_id uuid,org_id text,number text,status text,currency text,customer_name text,customer_email text,doc_type text,tax_rate numeric,issue_date date);
    create table invoice_doc_items(id bigint generated always as identity primary key,user_id uuid,org_id text,invoice_id bigint references invoice_docs,description text check(description<>'FAIL'),qty numeric(14,3),unit_price numeric(14,2),position integer);
    create table quotations(id bigint generated always as identity primary key,user_id uuid,org_id text,number text,status text,currency text,customer_name text,quote_date date);
    create table quotation_items(id bigint generated always as identity primary key,user_id uuid,org_id text,quotation_id bigint references quotations,product text check(product<>'FAIL'),qty numeric(14,3),rate numeric(14,2),position integer);
    create table purchase_orders(id bigint generated always as identity primary key,user_id uuid,org_id text,po_number text,status text,currency text,supplier_id bigint,supplier_name text,total numeric,order_date date);
    create table purchase_order_items(id bigint generated always as identity primary key,user_id uuid,org_id text,po_id bigint references purchase_orders,description text check(description<>'FAIL'),quantity numeric(14,3),unit_cost numeric(14,2),position integer);
    create table audit_log(id bigint generated always as identity primary key,user_id uuid,actor text,action text,entity text,details text);
    create table company_profile(id bigint generated always as identity primary key);
    create table crm_customers(id bigint generated always as identity primary key);
    insert into profiles values('10000000-0000-0000-0000-000000000001','ORG');
    insert into org_members values('10000000-0000-0000-0000-000000000001','ORG','owner');
  `;
  const checks = readFileSync(join(root, 'supabase/tests/channel-agent-hardening.sql'), 'utf8');
  const identity = readFileSync(join(root, 'supabase/2026-09-29-einvoice-identity.sql'), 'utf8');
  const identityChecks = readFileSync(join(root, 'supabase/tests/einvoice-identity.sql'), 'utf8');
  const scheduledSetup = `
    create table licenses(id uuid primary key default gen_random_uuid(),user_id uuid,product text,status text,created_at timestamptz default now());
    create table license_devices(id uuid primary key default gen_random_uuid(),license_id uuid references licenses,fingerprint text,device_name text,activated_at timestamptz default now(),deactivated_at timestamptz,unique(license_id,fingerprint));
    alter table suppliers add column address text,add column email text,add column phone text,add column tax_id text;
    create table products(id bigint generated always as identity primary key,org_id text,name text,quantity numeric(14,3),reorder_level numeric(14,3),cost_price numeric(14,2),supplier_id bigint,unit text);
    alter table purchase_orders add column supplier_address text,add column supplier_email text,add column supplier_phone text,add column supplier_trn text,add column notes text;
    alter table purchase_order_items add column product_id bigint,add column unit text;
  `;
  const scheduled = readFileSync(
    join(root, "supabase/2026-09-30-scheduled-write-integrity.sql"),
    "utf8"
  );
  const scheduledChecks = readFileSync(
    join(root, "supabase/tests/scheduled-write-integrity.sql"),
    "utf8"
  );
  console.log(
    run(
      "psql",
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(port),
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      setup +
        identity +
        identity +
        identityChecks +
        migration +
        migration +
        checks +
        scheduledSetup +
        scheduled +
        scheduled +
        scheduledChecks
    ).trim()
  );
  const psqlArgs = [
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
  ];
  const sql = (statement) =>
    promisify(execFile)(
      join(bin, "psql" + (process.platform === "win32" ? ".exe" : "")),
      [...psqlArgs, "-c", statement],
      { encoding: "utf8", windowsHide: true }
    );
  const role = "set request.jwt.claim.role='service_role';";
  const owner = "'10000000-0000-0000-0000-000000000001'";
  const claims = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      sql(role + `select filey_claim_license_device(${owner},'race-${i}','test');`)
    )
  );
  if (claims.filter((r) => r.status === "fulfilled").length !== 2)
    throw new Error("Concurrent license claims did not preserve exactly two slots");
  const drafts = await Promise.all(
    Array.from({ length: 6 }, () =>
      sql(role + `select filey_agent_lowstock_po(${owner},'ORG');`)
    )
  );
  if (drafts.filter((r) => r.stdout.includes("Scheduled supplier")).length !== 1)
    throw new Error("Concurrent scheduled drafts were duplicated");
  run(
    "psql",
    psqlArgs,
    `do $$ begin
    if (select count(*) from license_devices where deactivated_at is null)<>2 then raise exception 'Concurrent device limit failed'; end if;
    if (select count(*) from purchase_orders where notes='Auto-created from low stock (agent)')<>1 then raise exception 'Concurrent draft duplication'; end if;
  end $$;`
  );
  console.log(
    "PASS: eight concurrent license claims preserve two slots; six concurrent low-stock jobs create one complete draft."
  );
  console.log(
    "PASS: repeatable e-invoice identity, stale UUID protection; hosted draft scope, role gate, precision, field allowlist and atomic rollback."
  );
} finally {
  if (started) run('pg_ctl', ['-D', temp, '-m', 'immediate', '-w', 'stop']);
  const resolvedTemp = resolve(temp);
  if (!resolvedTemp.startsWith(resolve(tmpdir()) + sep) || !resolvedTemp.split(sep).at(-1).startsWith('filey-channel-')) throw new Error('Unexpected temporary cluster path');
  rmSync(resolvedTemp, { recursive: true, force: true });
}
