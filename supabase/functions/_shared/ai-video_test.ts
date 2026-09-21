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

Deno.test(
  "video handler verifies callbacks and recovers uncertain submissions without duplicate generation",
  async () => {
    const vars = {
      SUPABASE_URL: "https://fixture.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
      HF_API_KEY_ID: "fixture-id",
      HF_API_KEY_SECRET: "fixture-secret",
    };
    const previous = Object.fromEntries(
      Object.keys(vars).map((k) => [k, Deno.env.get(k)])
    );
    for (const [k, v] of Object.entries(vars)) Deno.env.set(k, v);
    const realFetch = globalThis.fetch;
    const user = "31000000-0000-4000-8000-000000000001";
    const providerId = "92000000-0000-4000-8000-000000000001";
    let job: Record<string, any> | undefined;
    let paidPosts = 0,
      settlements = 0,
      statusReads = 0;
    let submit: "ok" | "lost" | "reject" = "ok";
    let providerStatus = "in_progress";
    const response = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.hostname === "api.higgsfield.ai") {
        assert(req.headers.get("authorization") === "Key fixture-id:fixture-secret");
        if (url.pathname.startsWith("/estimate/")) return response({ usd: "0.75" });
        if (url.pathname.endsWith("/status")) {
          statusReads++;
          return response({
            request_id: providerId,
            status: providerStatus,
            video: { url: "https://cdn.example.com/video.mp4" },
          });
        }
        paidPosts++;
        const callback = new URL(url.searchParams.get("hf_webhook")!);
        assert(callback.searchParams.get("token") === job?.callback_token);
        if (submit === "lost") throw new TypeError("Lost response after submission");
        if (submit === "reject")
          return response({ detail: "private provider message" }, 401);
        return response({ request_id: providerId, status: "queued" });
      }
      assert(url.hostname === "fixture.supabase.co", "Unexpected network call");
      if (url.pathname === "/auth/v1/user")
        return response({ id: user, email_confirmed_at: "2026-01-01" });
      if (url.pathname.endsWith("/filey_take_rate_limit")) return response(true);
      if (url.pathname.endsWith("/filey_ai_video")) {
        const args = await req.json();
        assert(args.p_user === user && args.p_id === job?.id);
        let claimed = false;
        if (args.p_action === "start" && job!.state === "draft") {
          job!.state = "submitting";
          job!.started_at = new Date().toISOString();
          claimed = true;
        }
        if (args.p_action === "accepted") {
          job!.provider_request_id = args.p_args.request_id;
          job!.state = "queued";
        }
        if (args.p_action === "uncertain") job!.state = "uncertain";
        if (args.p_action === "poll") claimed = true;
        if (
          args.p_action === "finish" &&
          !["completed", "failed", "nsfw", "canceled"].includes(job!.state)
        ) {
          job!.state = args.p_args.state;
          job!.output_url = args.p_args.output_url;
          job!.error = args.p_args.error;
          if (job!.state === "completed") {
            job!.charged_micros = job!.charge_micros;
            settlements++;
          }
        }
        return response({ job, claimed });
      }
      if (url.pathname.endsWith("/ai_video_jobs")) {
        if (req.method === "POST") {
          job = {
            ...(await req.json()),
            state: "draft",
            charged_micros: 0,
            created_at: new Date().toISOString(),
            quote_expires_at: new Date(Date.now() + 600000).toISOString(),
          };
          return response(job);
        }
        if (url.searchParams.has("user_id"))
          assert(
            url.searchParams.get("user_id") === `eq.${user}`,
            "Missing account filter"
          );
        return response(
          job && url.searchParams.get("id") === `eq.${job.id}` ? [job] : []
        );
      }
      throw new Error(`Unexpected route ${url.pathname}`);
    };
    const call = async (body: unknown, query = "") => {
      const res = await handleRequest(
        new Request(`https://fixture.supabase.co/functions/v1/ai-video${query}`, {
          method: "POST",
          headers: { Authorization: "Bearer fixture-user" },
          body: JSON.stringify(body),
        })
      );
      return { status: res.status, body: await res.json() };
    };
    const quote = () => call({ action: "quote", prompt: "Fixture brand", duration: 5 });
    const start = () => call({ action: "start", id: job!.id, charge_micros: 1250000 });
    const callback = (token = job!.callback_token) =>
      call(
        {
          request_id: providerId,
          status: "completed",
          payload: { video: { url: "https://untrusted.example.com/fake.mp4" } },
        },
        `?callback=1&job=${job!.id}&token=${token}`
      );
    try {
      const q = await quote();
      assert(q.status === 200 && q.body.job.charge_micros === 1250000);
      assert(
        !("callback_token" in q.body.job) &&
          !("params" in q.body.job) &&
          !("provider_quote_micros" in q.body.job)
      );
      await start();
      await start();
      assert(paidPosts === 1, "Generate retry submitted twice");
      const forged = await callback("x".repeat(64));
      assert(forged.status === 403 && statusReads === 0);
      await callback();
      assert(
        job!.state === "in_progress" && settlements === 0,
        "Untrusted completed callback charged the wallet"
      );
      providerStatus = "completed";
      await callback();
      await callback();
      assert(
        Number(settlements) === 1 &&
          job!.output_url === "https://cdn.example.com/video.mp4"
      );
      submit = "lost";
      await quote();
      await start();
      await start();
      assert(
        Number(paidPosts) === 2 && job!.state === "uncertain",
        "Ambiguous submission must never retry"
      );
      await callback();
      assert(
        Number(settlements) === 2 && job!.provider_request_id === providerId,
        "Verified callback recovers a missing submission response"
      );
      submit = "reject";
      await quote();
      const failed = await start();
      assert(failed.body.job.state === "failed" && failed.body.job.charged_micros === 0);
      assert(
        !JSON.stringify(failed.body).includes("fixture-secret") &&
          !JSON.stringify(failed.body).includes("private provider message")
      );
      const unavailable = await call({
        action: "get",
        id: "91000000-0000-4000-8000-000000000099",
      });
      assert(unavailable.status === 400);
    } finally {
      globalThis.fetch = realFetch;
      for (const [k, v] of Object.entries(previous))
        v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
  }
);
