import { fixtureJwt } from "./test-auth-fixture.ts";
import {
  videoInput,
  videoQuote,
  providerCost,
  publicHttps,
  referenceImage,
  requestUrl,
  boundedJson,
} from "./ai-video.ts";
import { handleRequest } from "../ai-video/index.ts";
function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function rejects(fn: () => unknown) {
  let failed = false;
  try {
    fn();
  } catch {
    failed = true;
  }
  assert(failed);
}

Deno.test(
  "video trust boundaries fix pricing, duration, reference bytes and destinations",
  async () => {
    for (const n of [4, 5, 10, 15]) assert(videoQuote(n) === n * 250_000);
    for (const n of [0, -1, 3, 16, 4.5, NaN, Infinity]) rejects(() => videoQuote(n));
    for (const duration of ["5", null, undefined, 2.5])
      rejects(() => videoInput({ prompt: "test", duration }));
    rejects(() => videoInput({ prompt: " ", duration: 5 }));
    rejects(() => videoInput({ prompt: "test", duration: 5, aspect_ratio: "auto" }));
    const params = videoInput({
      prompt: " test ",
      duration: 5,
      price: 0,
      model: "expensive",
      resolution: "4k",
    });
    assert(
      params.resolution === "720p" &&
        params.prompt === "test" &&
        !("price" in params) &&
        !("model" in params)
    );
    assert(providerCost({ usd: "0.750" }, 1250000) === 750000);
    for (const usd of [null, undefined, "", -1, "NaN", 100])
      rejects(() => providerCost({ usd }, 1250000));
    for (const url of [
      "http://cdn.example.com/a",
      "https://127.0.0.1/a",
      "https://[::1]/a",
      "https://a:b@cdn.example.com/a",
      "https://x.internal/a",
    ])
      rejects(() => publicHttps(url));
    assert(publicHttps("https://cdn.example.com/video.mp4").endsWith(".mp4"));
    rejects(() => requestUrl("../private", "status"));
    rejects(() =>
      referenceImage({ type: "image/png", data: btoa("not actually an image") })
    );
    let oversized = false;
    try {
      await boundedJson(
        new Request("https://example.com", { method: "POST", body: " ".repeat(100) }),
        32
      );
    } catch {
      oversized = true;
    }
    assert(oversized);
  }
);

Deno.test("video service retires new Coin jobs while authenticated legacy reads and callback settlement keep working", async () => {
  const vars = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", HF_API_KEY_ID: "fixture-id", HF_API_KEY_SECRET: "fixture-secret" };
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(vars)) Deno.env.set(key, value);
  const realFetch = globalThis.fetch;
  const user = "31000000-0000-4000-8000-000000000001";
  const providerId = "92000000-0000-4000-8000-000000000001";
  let job!: Record<string, any>;
  let settlements = 0, statusReads = 0, paidPosts = 0, rpcCalls = 0, rowWrites = 0;
  let providerStatus = "in_progress", authenticated = true;
  let privateFailure: "none" | "database" | "provider" = "none";
  const privateDetail = "fixture-provider-key-private-prompt-and-database-row";
  const makeJob = (state = "draft", knownRequest = true) => {
    job = { id: "91000000-0000-4000-8000-000000000001", user_id: user, state, model: "bytedance/seedance-2.0/text-to-video", params: { prompt: "Historical fixture", aspect_ratio: "9:16", generate_audio: true }, duration: 5, charge_micros: 1250000, charged_micros: 0, callback_token: "a".repeat(64), created_at: new Date().toISOString(), started_at: new Date().toISOString(), quote_expires_at: new Date(Date.now() + 600000).toISOString(), ...(knownRequest ? { provider_request_id: providerId } : {}) };
  };
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    if (url.hostname === "api.higgsfield.ai") {
      assert(req.headers.get("authorization") === "Key fixture-id:fixture-secret");
      if (url.pathname.endsWith("/status")) {
        statusReads++;
        if (privateFailure === "provider") return new Response(`invalid provider JSON ${privateDetail}`);
        return response({ request_id: providerId, status: providerStatus, video: { url: "https://cdn.example.com/video.mp4" } });
      }
      if (url.pathname.endsWith("/cancel")) return response({ ok: true });
      paidPosts++;
      throw new Error("New funded provider request must never be sent");
    }
    assert(url.hostname === "fixture.supabase.co", "Unexpected network call");
    if (url.pathname === "/auth/v1/user") return authenticated ? response({ id: user, email_confirmed_at: "2026-01-01" }) : response({ error: "Unauthorized" }, 401);
    if (url.pathname.endsWith("/filey_take_rate_limit")) return response(true);
    if (url.pathname.endsWith("/filey_ai_video")) {
      const args = await req.json(); rpcCalls++;
      assert(args.p_user === user);
      if (privateFailure === "database") return response({ code: "XX000", message: privateDetail }, 500);
      if (args.p_action === "list") return response({ jobs: [job] });
      assert(args.p_id === job.id);
      assert(!["start", "quote"].includes(args.p_action), "No new Coin reservation is allowed");
      if (args.p_action === "accepted") { job.provider_request_id = args.p_args.request_id; job.state = "queued"; }
      if (args.p_action === "discard") job.state = "canceled";
      if (args.p_action === "finish" && !["completed", "failed", "nsfw", "canceled"].includes(job.state)) {
        job.state = args.p_args.state; job.output_url = args.p_args.output_url; job.error = args.p_args.error;
        if (job.state === "completed") { job.charged_micros = job.charge_micros; settlements++; }
      }
      return response({ job, claimed: args.p_action === "poll" });
    }
    if (url.pathname.endsWith("/ai_video_jobs")) {
      if (req.method !== "GET") { rowWrites++; throw new Error("New funded job row must never be written"); }
      if (url.searchParams.has("user_id")) assert(url.searchParams.get("user_id") === `eq.${user}`, "Missing account filter");
      return response(url.searchParams.get("id") === `eq.${job.id}` ? [job] : []);
    }
    throw new Error(`Unexpected route ${url.pathname}`);
  };
  const call = async (body: unknown, query = "") => {
    const res = await handleRequest(new Request(`https://fixture.supabase.co/functions/v1/ai-video${query}`, { method: "POST", headers: { Authorization: `Bearer ${fixtureJwt(user)}` }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  const callback = (token = job.callback_token) => call({ request_id: providerId, status: "completed", payload: { video: { url: "https://untrusted.example.com/fake.mp4" } } }, `?callback=1&job=${job.id}&token=${token}`);
  try {
    makeJob();
    for (const action of ["quote", "start"]) {
      const rejected = await call({ action, id: job.id, prompt: "New film", duration: 5, charge_micros: 1250000 });
      assert(rejected.status === 409 && rejected.body.error.includes("own API key"));
    }
    assert(paidPosts === 0 && rpcCalls === 0 && rowWrites === 0, "Stale clients cannot create jobs or reserve Coin");
    authenticated = false;
    assert((await call({ action: "start", id: job.id })).status === 401);
    authenticated = true;
    const listed = await call({ action: "list" });
    assert(listed.status === 200 && listed.body.configured === false && listed.body.jobs.length === 1);
    assert(!("callback_token" in listed.body.jobs[0]) && !("params" in listed.body.jobs[0]));
    const discarded = await call({ action: "cancel", id: job.id });
    assert(discarded.body.job.state === "canceled" && statusReads === 0);
    makeJob("queued");
    const forged = await callback("x".repeat(64));
    assert(forged.status === 403 && statusReads === 0);
    await callback();
    assert(job.state === "in_progress" && settlements === 0, "Forged completed payload must not settle a wallet");
    providerStatus = "completed";
    await callback(); await callback();
    assert(Number(settlements) === 1 && job.output_url === "https://cdn.example.com/video.mp4");
    makeJob("uncertain", false);
    await callback(); await callback();
    assert(Number(settlements) === 2 && job.provider_request_id === providerId, "Verified callback recovers a historical ambiguous submission once");
    makeJob("queued"); providerStatus = "canceled";
    const canceled = await call({ action: "cancel", id: job.id });
    assert(canceled.body.job.state === "canceled" && canceled.body.job.charged_micros === 0);
    const missing = await call({ action: "get", id: "91000000-0000-4000-8000-000000000099" });
    assert(missing.status === 400);
    privateFailure = "database";
    for (const action of ["list", "get", "cancel"]) {
      makeJob(action === "cancel" ? "draft" : "queued");
      const failed = await call({ action, id: job.id });
      assert(failed.status === 503 && !JSON.stringify(failed.body).includes(privateDetail), "SQL details must not leave the video service");
    }
    privateFailure = "provider";
    makeJob("queued");
    const failed = await call({ action: "get", id: job.id });
    assert(failed.status === 503 && !JSON.stringify(failed.body).includes(privateDetail), "Provider JSON errors must not echo private response bodies");
    privateFailure = "none";
    for (const body of ["null", "[]", "{"]) {
      const invalid = await handleRequest(new Request("https://fixture.supabase.co/functions/v1/ai-video", { method: "POST", headers: { Authorization: `Bearer ${fixtureJwt(user)}` }, body }));
      assert(invalid.status === 400 && (await invalid.json()).error === "Invalid JSON video request.");
    }
    assert(paidPosts === 0 && rowWrites === 0);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(previous)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
});
