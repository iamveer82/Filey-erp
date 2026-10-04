import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { converterEnvironment, runConverter, workerFetch, reportConversionFailure, CONVERSION_FAILURE } from "./runtime.js";

const execute = promisify(execFile);

test("a real converter child cannot read server or provider credentials from its environment", async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "filey-worker-privacy-"));
  try {
    const sentinel = "synthetic-service-role-secret";
    const inherited = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      SUPABASE_SERVICE_ROLE_KEY: sentinel, DEEPSEEK_API_KEY: "synthetic-ai-key", AWS_SECRET_ACCESS_KEY: "synthetic-storage-key",
      HTTPS_PROXY: "https://synthetic-user:synthetic-password@proxy.invalid", NODE_OPTIONS: "--trace-warnings" };
    const code = "console.log(JSON.stringify({service:process.env.SUPABASE_SERVICE_ROLE_KEY,ai:process.env.DEEPSEEK_API_KEY,storage:process.env.AWS_SECRET_ACCESS_KEY,proxy:process.env.HTTPS_PROXY,nodeOptions:process.env.NODE_OPTIONS,home:process.env.HOME,temp:process.env.TMPDIR}))";
    const vulnerable = await execute(process.execPath, ["-e", code], { env: inherited });
    assert.ok(vulnerable.stdout.includes(sentinel), "the old inherited-env path leaks the synthetic service key");
    const result = await execute(process.execPath, ["-e", code], { env: converterEnvironment(work, inherited) });
    assert.deepEqual(JSON.parse(result.stdout), { home: work, temp: work });
    const env = converterEnvironment(work, inherited);
    assert.equal(env.PATH, inherited.PATH);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.HTTPS_PROXY, undefined);
  } finally { await fs.rm(work, { recursive: true, force: true }); }
});

test("converter invocation preserves literal paths, runtime limits and an isolated environment", async () => {
  const args = ["--skip-text", "invoice $() with spaces.pdf", "out.pdf"];
  await runConverter(async (binary, actual, options) => {
    assert.equal(binary, "ocrmypdf"); assert.equal(actual, args);
    assert.equal(options.cwd, "/synthetic/job"); assert.equal(options.timeout, 600000);
    assert.equal(options.maxBuffer, 1024 * 1024);
    assert.equal(options.env.HOME, "/synthetic/job");
    assert.equal(options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  }, "ocrmypdf", args, "/synthetic/job", 600000);
});

test("real converter stderr containing private text never reaches the job receipt or logs", async () => {
  let receipt;
  const logs = [];
  try {
    await execute(process.execPath, ["-e", "console.error('synthetic-private-invoice synthetic-api-secret'); process.exit(1)"]);
    assert.fail("converter must fail");
  } catch (error) {
    assert.ok(error.message.includes("synthetic-private-invoice"), "raw child errors contain document diagnostics");
    await reportConversionFailure({}, { id: "synthetic-job" }, async (_client, _job, patch) => { receipt = patch; }, message => logs.push(message));
  }
  assert.equal(receipt.status, "error"); assert.equal(receipt.error, CONVERSION_FAILURE);
  assert.ok(!JSON.stringify({ receipt, logs }).includes("synthetic-private"));
  assert.ok(!JSON.stringify({ receipt, logs }).includes("synthetic-api-secret"));
});

test("worker service-role requests refuse actual redirects without reaching the destination", async () => {
  let targetRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { location: "/credential-target" }); res.end(); }
    else { targetRequests++; res.end("unexpected"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/redirect`;
    await assert.rejects(workerFetch()(url, { headers: { Authorization: "Bearer synthetic-service-role" }, redirect: "follow" }));
    assert.equal(targetRequests, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("worker fetch preserves credentials for the intended endpoint and obeys caller cancellation", async () => {
  const caller = new AbortController();
  const request = workerFetch(async (input, init) => {
    assert.equal(input, "https://synthetic.supabase.invalid/storage");
    assert.equal(init.headers.Authorization, "Bearer synthetic-service-role");
    assert.equal(init.redirect, "error");
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  })("https://synthetic.supabase.invalid/storage", { headers: { Authorization: "Bearer synthetic-service-role" }, signal: caller.signal });
  caller.abort(new Error("synthetic caller stop"));
  await assert.rejects(request, /synthetic caller stop/);
});

test("worker fetch times out an unresponsive endpoint and handles already-aborted requests", async () => {
  const fake = async (_input, init) => new Promise((_, reject) => {
    if (init.signal.aborted) reject(init.signal.reason);
    else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  await assert.rejects(workerFetch(fake, 10)("https://synthetic.supabase.invalid"), /timed out/);
  const caller = new AbortController(); caller.abort(new Error("stopped before request"));
  await assert.rejects(workerFetch(fake)("https://synthetic.supabase.invalid", { signal: caller.signal }), /stopped before request/);
});
