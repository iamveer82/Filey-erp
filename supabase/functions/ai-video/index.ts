import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS, json, rateLimit } from "../_shared/rateLimit.ts";
import {
  boundedJson,
  higgsfield,
  HiggsfieldError,
  providerCost,
  publicHttps,
  referenceImage,
  requestUrl,
  uploadReference,
  VIDEO_MODEL,
  VIDEO_TERMINAL,
  VIDEO_UUID,
  videoInput,
  videoQuote,
  HF_ORIGIN,
} from "../_shared/ai-video.ts";

type Admin = SupabaseClient;
interface Job {
  [key: string]: unknown;
  id: string;
  user_id: string;
  state: string;
  model: string;
  params: { prompt: string; image_url?: string; aspect_ratio?: string; generate_audio: boolean };
  provider_request_id?: string;
  callback_token: string;
  started_at: string;
}
const fields = [
  "id",
  "state",
  "duration",
  "charge_micros",
  "charged_micros",
  "quote_expires_at",
  "output_url",
  "error",
  "created_at",
  "started_at",
];
export function publicJob(job: Job) {
  return {
    ...Object.fromEntries(fields.map((key) => [key, job[key]])),
    prompt: job.params.prompt,
    aspect_ratio: job.params.aspect_ratio ?? "source",
    generate_audio: job.params.generate_audio,
    has_reference: !!job.params.image_url,
  };
}
async function transition(
  admin: Admin,
  job: Job,
  action: string,
  args: Record<string, unknown> = {}
) {
  const { data, error } = await admin.rpc("filey_ai_video", {
    p_action: action,
    p_user: job.user_id,
    p_id: job.id,
    p_args: args,
  });
  if (error) throw new Error(error.message);
  return data as { job: Job; claimed: boolean };
}
async function lookup(admin: Admin, id: unknown, user?: string) {
  if (typeof id !== "string" || !VIDEO_UUID.test(id))
    throw new Error("Invalid video ID.");
  let query = admin.from("ai_video_jobs").select("*").eq("id", id);
  if (user) query = query.eq("user_id", user);
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error("This video is unavailable for your account.");
  return data as Job;
}

/** Webhooks and foreground polling converge on the same atomic settlement. */
async function reconcile(
  admin: Admin,
  job: Job,
  force = false,
  callbackId?: string
): Promise<Job> {
  if (job.state === "draft" || VIDEO_TERMINAL.has(job.state)) return job;
  if (!force) {
    const claim = await transition(admin, job, "poll");
    job = claim.job;
    if (!claim.claimed) return job;
  }
  const id = job.provider_request_id ?? callbackId;
  const expired = Date.now() - Date.parse(job.started_at) >= 86_400_000;
  if (id) {
    try {
      const path = requestUrl(id, "status").slice(HF_ORIGIN.length);
      const result = await (await higgsfield(path)).json();
      if (result.request_id && result.request_id !== id)
        throw new Error("Video status did not match the request.");
      if (
        !VIDEO_TERMINAL.has(result.status) &&
        !["queued", "in_progress"].includes(result.status)
      )
        throw new Error("The provider returned an unknown video status.");
      if (!job.provider_request_id)
        job = (await transition(admin, job, "accepted", { request_id: id })).job;
      if (VIDEO_TERMINAL.has(result.status)) {
        const output =
          result.status === "completed" ? publicHttps(result.video?.url) : null;
        return (
          await transition(admin, job, "finish", {
            state: result.status,
            output_url: output,
            error:
              result.status === "nsfw"
                ? "The provider could not generate this request under its content policy. No credits were used."
                : result.status === "failed"
                  ? "Video generation failed. No credits were used."
                  : null,
          })
        ).job;
      }
      if (!expired && result.status === job.state) return job;
      if (!expired)
        return (await transition(admin, job, "finish", { state: result.status })).job;
    } catch (error) {
      if (!expired) throw error;
      // Provider downtime must not keep a customer's hold alive past its deadline.
    }
  }
  if (expired)
    return (
      await transition(admin, job, "finish", {
        state: "failed",
        error:
          "The provider did not finish within 24 hours. Your credit hold was released.",
      })
    ).job;
  return job;
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const url = new URL(req.url);
  if (url.searchParams.get("callback") === "1") {
    try {
      const token = url.searchParams.get("token") ?? "";
      if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "Invalid callback." }, 403);
      const job = await lookup(admin, url.searchParams.get("job"));
      if (token !== job.callback_token) return json({ error: "Invalid callback." }, 403);
      const body = await boundedJson(req, 64_000);
      if (
        typeof body.request_id !== "string" ||
        !VIDEO_UUID.test(body.request_id) ||
        (job.provider_request_id && job.provider_request_id !== body.request_id)
      )
        return json({ error: "Request mismatch." }, 400);
      // Callback content is untrusted. A credentialed status read is the authority.
      await reconcile(admin, job, true, body.request_id);
      return json({ ok: true });
    } catch {
      return json({ error: "Video status could not be reconciled." }, 503);
    }
  }
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: auth, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !auth.user)
    return json(
      {
        error:
          "Sign in to your Filey cloud account to create or view videos. Device records stay on your device.",
      },
      401
    );
  const user = auth.user;
  try {
    const body = await boundedJson(req);
    const action = body.action;
    if (!["list", "quote", "get", "start", "cancel"].includes(String(action)))
      return json({ error: "Unknown video action." }, 400);
    if (
      !(await rateLimit(
        admin,
        user.id,
        action === "quote" ? "video_quote" : "video_read",
        action === "quote" ? 30 : 1000,
        3600
      ))
    )
      return json({ error: "Too many video requests. Please try again later." }, 429);
    if (action === "list") {
      const { data, error } = await admin.rpc("filey_ai_video", { p_action: "list", p_user: user.id, p_id: null });
      if (error) throw error;
      return json({
        jobs: data.jobs.map(publicJob),
        configured:
          !!Deno.env.get("HF_API_KEY_ID") && !!Deno.env.get("HF_API_KEY_SECRET"),
      });
    }
    if (action === "quote") {
      if (!user.email_confirmed_at)
        return json({ error: "Verify your email before generating videos." }, 403);
      const params: Record<string, unknown> = videoInput(body);
      const reference = referenceImage(body.reference);
      if (reference) {
        params.image_url = await uploadReference(reference);
        delete params.aspect_ratio;
      }
      const model = `${VIDEO_MODEL}/${reference ? "image-to-video" : "text-to-video"}`;
      const price = videoQuote(Number(params.duration));
      const estimate = await (
        await higgsfield(`/estimate/${model}`, {
          method: "POST",
          body: JSON.stringify(params),
        })
      ).json();
      const providerPrice = providerCost(estimate, price);
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("");
      const { data, error } = await admin
        .from("ai_video_jobs")
        .insert({
          id: crypto.randomUUID(),
          user_id: user.id,
          model,
          params,
          duration: params.duration,
          charge_micros: price,
          provider_quote_micros: providerPrice,
          callback_token: token,
        })
        .select()
        .single();
      if (error) throw error;
      return json({ job: publicJob(data) });
    }
    let job = await lookup(admin, body.id, user.id);
    if (action === "get") return json({ job: publicJob(await reconcile(admin, job)) });
    if (action === "cancel") {
      if (job.state === "draft") job = (await transition(admin, job, "discard")).job;
      else if (job.provider_request_id && !VIDEO_TERMINAL.has(job.state)) {
        try {
          await higgsfield(
            requestUrl(job.provider_request_id, "cancel").slice(HF_ORIGIN.length),
            { method: "POST" }
          );
        } catch (e) {
          if (!(e instanceof HiggsfieldError && e.status === 400)) throw e;
        }
        job = await reconcile(admin, job, true);
      }
      return json({
        job: publicJob(job),
        message: ["submitting", "uncertain", "in_progress"].includes(job.state)
          ? "The provider cannot cancel this job now. Its final result will determine the charge."
          : undefined,
      });
    }
    if (!user.email_confirmed_at)
      return json({ error: "Verify your email before generating videos." }, 403);
    if (!Deno.env.get("HF_API_KEY_ID") || !Deno.env.get("HF_API_KEY_SECRET"))
      throw new Error(
        "Video generation is not connected yet. Filey’s administrator needs to configure Higgsfield."
      );
    // The client can approve only a stored, immutable quote. Claiming and reserving
    // are one transaction, so concurrent clicks never submit two paid requests.
    const claim = await transition(admin, job, "start", {
      charge_micros: body.charge_micros,
    });
    job = claim.job;
    if (!claim.claimed) return json({ job: publicJob(job) });
    let submitted = false;
    try {
      const callback = new URL(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-video`);
      callback.searchParams.set("callback", "1");
      callback.searchParams.set("job", job.id);
      callback.searchParams.set("token", job.callback_token);
      const res = await higgsfield(
        `/${job.model}?hf_webhook=${encodeURIComponent(callback.href)}`,
        { method: "POST", body: JSON.stringify(job.params) }
      );
      submitted = true;
      const accepted = await res.json();
      requestUrl(accepted.request_id, "status");
      job = (
        await transition(admin, job, "accepted", { request_id: accepted.request_id })
      ).job;
    } catch (error) {
      if (
        !submitted &&
        error instanceof HiggsfieldError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      )
        job = (
          await transition(admin, job, "finish", {
            state: "failed",
            error: `${error.message} No credits were used.`,
          })
        ).job;
      else job = (await transition(admin, job, "uncertain")).job;
    }
    return json({ job: publicJob(job), retry_safe: false });
  } catch (e) {
    // Provider bodies may echo prompts or credentials. Only our safe messages leave this service.
    return json(
      {
        error:
          e instanceof Error ? e.message : "The video request could not be completed.",
      },
      400
    );
  }
}
if (import.meta.main) Deno.serve(handleRequest);
