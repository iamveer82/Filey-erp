/** Real stdio MCP handshake/calls against a throwaway HTTP auth/RLS fixture. No user data. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createPilotPolicy } from "./pilot.js";

// Independent contract assertion: changing the implementation allowlist must
// not silently make the safety smoke test accept another exposed tool.
const expectedPilotTools = ["get_financial_summary", "list_invoices", "get_invoice", "list_quotes", "list_orders",
  "list_purchase_orders", "list_customers", "find_customer", "list_products", "list_low_stock", "run_report"];

const USER = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000002", ORG = "fixture-org";
const jwt = (payload: Record<string, unknown>) => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
  Buffer.from(JSON.stringify(payload)).toString("base64url"), "fixture-signature"].join(".");
const token = jwt({ sub: USER, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
const anon = jwt({ role: "anon" });
const binding = JSON.stringify({ version: 1, user_id: USER, org_id: ORG, data_mode: "cloud" });
const serverPath = fileURLToPath(new URL("./index.js", import.meta.url));
const allModules = ["accounting", "invoicing", "inventory", "quoting", "orders", "purchase-orders", "customers", "reports"];
const state = { authUser: USER, profileId: USER, profileOrg: ORG, modules: allModules as string[] | null, admin: false,
  allowed: true, malformedAccess: false, permissionError: false, requests: 0, reads: [] as string[], writes: 0, revokeAfterRead: false, switchAfterRead: false };

const reset = () => Object.assign(state, { authUser: USER, profileId: USER, profileOrg: ORG, modules: [...allModules], admin: false,
  allowed: true, malformedAccess: false, permissionError: false, requests: 0, reads: [], writes: 0, revokeAfterRead: false, switchAfterRead: false });
const customers = [
  { id: 1, user_id: USER, org_id: ORG, name: "Own customer" },
  { id: 2, user_id: OTHER, org_id: ORG, name: "Other private customer" },
  { id: 3, user_id: USER, org_id: "other-org", name: "Other workspace customer" },
  { id: 4, user_id: OTHER, org_id: ORG, shared: true, name: "Explicitly shared customer" },
];
const invoices = [
  { id: 10, user_id: USER, org_id: ORG, number: "INV-FIXTURE", status: "draft", doc_type: null, tax_rate: 0 },
  { id: 11, user_id: USER, org_id: ORG, number: "BILL-FIXTURE", status: "draft", doc_type: "purchase", tax_rate: 0 },
];
const fixture = createServer((request, response) => {
  state.requests++;
  response.setHeader("Content-Type", "application/json");
  const reply = (body: unknown, code = 200) => { response.statusCode = code; response.end(JSON.stringify(body)); };
  if (request.headers.apikey !== anon || request.headers.authorization !== `Bearer ${token}`) return reply({ message: "Unauthorized fixture request" }, 401);
  const url = new URL(request.url!, "http://127.0.0.1");
  if (url.pathname === "/auth/v1/user") return reply({ id: state.authUser, role: "authenticated" });
  if (url.pathname === "/rest/v1/profiles") {
    assert.equal(url.searchParams.get("id"), `eq.${USER}`, "profile lookup binds the authenticated user");
    return reply({ id: state.profileId, org_id: state.profileOrg });
  }
  if (url.pathname === "/rest/v1/rpc/filey_module_access") {
    if (state.permissionError) return reply({ message: "Fixture permission unavailable" }, 503);
    return reply({ allowed: state.allowed, admin: state.admin, modules: state.malformedAccess ? [true] : state.modules });
  }
  if (request.method !== "GET") { state.writes++; return reply({ message: "Write attempted" }, 403); }
  const table = url.pathname.split("/").at(-1)!;
  state.reads.push(table);
  assert.equal(url.searchParams.get("org_id"), `eq.${ORG}`, "all tool reads bind the current workspace");
  const rows = table === "crm_customers" ? customers : table === "invoice_docs" ? invoices : [];
  // The fixture enforces the actual user Authorization header, private rows and org filter.
  let visible = rows.filter(row => row.org_id === ORG && (row.user_id === USER || "shared" in row && row.shared));
  if (table === "invoice_docs") {
    if (url.searchParams.has("or")) visible = visible.filter(row => !("doc_type" in row) || row.doc_type !== "purchase");
    if (url.searchParams.has("number")) visible = visible.filter(row => "number" in row && `eq.${row.number}` === url.searchParams.get("number"));
  }
  if (state.revokeAfterRead) state.modules = [];
  if (state.switchAfterRead) state.profileOrg = "other-org";
  return reply(request.headers.accept?.includes("application/vnd.pgrst.object+json") ? visible[0] ?? null : visible);
});
await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
const environment = { PATH: process.env.PATH ?? "", FILEY_MCP_MODE: "hermes-pilot", FILEY_HERMES_BINDING: binding,
  SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_ACCESS_TOKEN: token };

async function connection(overrides: Record<string, string> = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { ...environment, ...overrides }, stderr: "pipe" });
  let diagnostics = "";
  transport.stderr?.on("data", chunk => { diagnostics += String(chunk); });
  const client = new Client({ name: "filey-hermes-pilot-smoke", version: "1" });
  try {
    await client.connect(transport, { timeout: 10_000 });
    return { client, close: () => client.close(), diagnostics: () => diagnostics };
  } catch (error) { await transport.close(); throw error; }
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 10_000 });
  const content = result.content as { type: string; text?: string }[];
  assert.equal(content[0]?.type, "text");
  return { result, payload: JSON.parse(content[0].text!) as Record<string, any> };
};
let checks = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  reset(); await fn(); checks++; console.log(`  PASS ${name}`);
}
async function rejectsStartup(overrides: Record<string, string>) {
  const before = state.requests;
  await assert.rejects(connection(overrides));
  assert.equal(state.reads.length, 0, "a misbound child cannot read business data");
  return state.requests - before;
}

try {
  await test("real initialize/list only advertises eleven read tools", async () => {
    const app = await connection();
    try { assert.deepEqual((await app.client.listTools()).tools.map(tool => tool.name).sort(), [...expectedPilotTools].sort()); }
    finally { await app.close(); }
  });
  await test("actual read uses user JWT and respects private/shared/workspace rows", async () => {
    const app = await connection();
    try {
      const { payload } = await call(app.client, "list_customers");
      assert.equal(payload.count, 2);
      assert.deepEqual(payload.customers.map((row: { name: string }) => row.name), ["Own customer", "Explicitly shared customer"]);
      assert.equal(state.writes, 0);
    } finally { await app.close(); }
  });
  await test("denied write is not registered and cannot dispatch", async () => {
    const app = await connection();
    try {
      const result = await app.client.callTool({ name: "create_draft_invoice", arguments: { customer_name: "Never saved", items: [] } });
      assert.equal(result.isError, true); assert.equal(state.writes, 0); assert.equal(state.reads.length, 0);
    } finally { await app.close(); }
  });
  await test("malformed/extra-field/wrong-mode binding fails before network", async () => {
    for (const value of ["not-json", "null", binding.replace('"version":1', '"version":2'), binding.replace('"cloud"', '"local"'),
      JSON.stringify({ version: 1, user_id: USER, org_id: ORG, data_mode: "cloud", admin: true })])
      assert.equal(await rejectsStartup({ FILEY_HERMES_BINDING: value }), 0);
  });
  await test("cross-owner user JWT cannot satisfy a different binding", async () => {
    assert.equal(await rejectsStartup({ FILEY_HERMES_BINDING: binding.replace(USER, OTHER) }), 0);
  });
  await test("authenticated server user cannot differ from decoded token owner", async () => {
    state.authUser = OTHER; assert.ok(await rejectsStartup({}) > 0);
  });
  await test("profile owner/org mismatches fail before tools are exposed", async () => {
    state.profileId = OTHER; await rejectsStartup({});
    state.profileId = USER; state.profileOrg = "other-org"; await rejectsStartup({});
  });
  await test("service-role access tokens and admin/secret API keys are refused", async () => {
    for (const overrides of [{ SUPABASE_ACCESS_TOKEN: jwt({ role: "service_role", sub: USER, exp: 9_999_999_999 }) },
      { SUPABASE_ANON_KEY: jwt({ role: "service_role" }) }, { SUPABASE_ANON_KEY: "sb_secret_fixture_DO_NOT_PRINT" },
      { SUPABASE_SERVICE_ROLE_KEY: "DO_NOT_PRINT" }] as Record<string, string>[]) assert.equal(await rejectsStartup(overrides), 0);
  });
  await test("expired/malformed/anonymous user tokens are refused", async () => {
    for (const value of ["not-a-jwt", anon, jwt({ role: "authenticated", sub: USER, exp: 1 }), jwt({ role: "authenticated", sub: USER })])
      assert.equal(await rejectsStartup({ SUPABASE_ACCESS_TOKEN: value }), 0);
  });
  await test("pilot never falls back to local DB or password authentication", async () => {
    for (const overrides of [{ FILEY_LOCAL: "1" }, { FILEY_LOCAL_DB: "fixture-only.db" }, { FILEY_EMAIL: "fixture@test.invalid", FILEY_PASSWORD: "DO_NOT_PRINT" }] as Record<string, string>[])
      assert.equal(await rejectsStartup(overrides), 0);
  });
  await test("live restricted module membership denies before business reads", async () => {
    state.modules = ["inventory"];
    const app = await connection();
    try {
      assert.equal((await call(app.client, "list_customers")).result.isError, true);
      assert.equal(state.reads.length, 0);
      assert.equal((await call(app.client, "list_products")).payload.count, 0);
    } finally { await app.close(); }
  });
  await test("financial summary/report checks every consulted module", async () => {
    state.modules = ["accounting", "invoicing"];
    const app = await connection();
    try {
      assert.equal((await call(app.client, "get_financial_summary")).result.isError, true);
      assert.equal((await call(app.client, "run_report", { report: "sales_by_month" })).result.isError, true);
      assert.equal(state.reads.length, 0);
    } finally { await app.close(); }
  });
  await test("permission revocation or lookup failure does not use startup permissions", async () => {
    const app = await connection();
    try {
      state.allowed = false; assert.equal((await call(app.client, "list_customers")).result.isError, true);
      state.allowed = true; state.malformedAccess = true; assert.equal((await call(app.client, "list_customers")).result.isError, true);
      state.malformedAccess = false; state.permissionError = true; assert.equal((await call(app.client, "list_customers")).result.isError, true);
      assert.equal(state.reads.length, 0);
    } finally { await app.close(); }
  });
  await test("post-read module revocation discards the fetched records", async () => {
    const app = await connection();
    try {
      state.revokeAfterRead = true;
      const { payload, result } = await call(app.client, "list_customers");
      assert.equal(result.isError, true); assert.equal(payload.code, "pilot_access_denied");
      assert.ok(!JSON.stringify(payload).includes("Own customer"));
    } finally { await app.close(); }
  });
  await test("post-read workspace switch discards the fetched records", async () => {
    const app = await connection();
    try {
      state.switchAfterRead = true;
      const { payload, result } = await call(app.client, "list_customers");
      assert.equal(result.isError, true); assert.ok(!JSON.stringify(payload).includes("Own customer"));
    } finally { await app.close(); }
  });
  await test("sales invoice lookup cannot reveal a purchase document", async () => {
    const app = await connection();
    try {
      assert.equal((await call(app.client, "get_invoice", { number: "INV-FIXTURE" })).payload.number, "INV-FIXTURE");
      assert.equal((await call(app.client, "get_invoice", { number: "BILL-FIXTURE" })).result.isError, true);
    } finally { await app.close(); }
  });
  await test("pinned mode/owner/org/token changes fail closed in the current process", () => {
    const keys = Object.keys(environment), previous = keys.map(key => process.env[key]);
    try {
      Object.assign(process.env, environment);
      const policy = createPilotPolicy()!;
      policy.assertCurrent();
      for (const [key, value] of [["FILEY_MCP_MODE", "standard"], ["FILEY_HERMES_BINDING", binding.replace(ORG, "other-org")], ["SUPABASE_ACCESS_TOKEN", "replaced-token"]]) {
        process.env[key] = value; assert.throws(() => policy.assertCurrent()); Object.assign(process.env, environment);
      }
    } finally { keys.forEach((key, index) => previous[index] === undefined ? delete process.env[key] : process.env[key] = previous[index]); }
  });
  console.log(`HERMES PILOT SMOKE OK — ${checks} checks passed; no writes, real stdio MCP and fixture-only HTTP.`);
} finally { await new Promise<void>(resolve => fixture.close(() => resolve())); }
