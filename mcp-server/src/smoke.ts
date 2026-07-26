/**
 * Offline smoke test: spawn the built server, run the MCP handshake over stdio,
 * request tools/list and assert exactly the expected 17 tool names come back.
 * No env vars, no network access required.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const EXPECTED = [
  "get_financial_summary",
  "list_invoices",
  "get_invoice",
  "list_quotes",
  "list_orders",
  "list_purchase_orders",
  "list_customers",
  "find_customer",
  "list_products",
  "list_low_stock",
  "run_report",
  "create_draft_invoice",
  "create_draft_quote",
  "create_draft_po",
  "add_customer",
  "add_product",
  "request_payment_reminder",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "index.js");

function fail(msg: string): never {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { PATH: process.env.PATH ?? "" }, // deliberately no SUPABASE_* / FILEY_* vars
});

let buffer = "";
const pending = new Map<number, (msg: any) => void>();
let nextId = 1;

child.stdout!.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx: number;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(`non-JSON line on stdout: ${line.slice(0, 200)}`);
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  }
});

child.on("exit", (code) => fail(`server exited early (code ${code})`));

function send(msg: object): void {
  child.stdin!.write(JSON.stringify(msg) + "\n");
}

function request(method: string, params?: object): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${method} error: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

async function main(): Promise<void> {
  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "filey-erp-smoke", version: "0.1.0" },
  });
  if (!init?.serverInfo?.name) fail("initialize response missing serverInfo");

  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const list = await request("tools/list", {});
  const names: string[] = (list?.tools ?? []).map((t: any) => t.name).sort();
  const expected = [...EXPECTED].sort();

  if (names.length !== expected.length) {
    fail(`expected ${expected.length} tools, got ${names.length}: ${names.join(", ")}`);
  }
  const missing = expected.filter((n) => !names.includes(n));
  const extra = names.filter((n) => !expected.includes(n));
  if (missing.length || extra.length) {
    fail(`tool mismatch — missing: [${missing.join(", ")}] extra: [${extra.join(", ")}]`);
  }

  console.log(`SMOKE OK — server '${init.serverInfo.name}' v${init.serverInfo.version} exposed ${names.length} tools:`);
  for (const n of names) console.log(`  - ${n}`);
  child.kill();
  process.exit(0);
}

main().catch((err) => fail(err?.message ?? String(err)));
