import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS, json, rateLimit } from "../_shared/rateLimit.ts";
import { creditGateway, gatewayReceipt } from "../_shared/ai-credit-gateway.ts";
import {
  chargedMicros,
  type CreditModel,
  creditModels,
  creditPacks,
  customCreditProduct,
  FREE_REQUESTS_PER_DAY,
  MAX_TOPUP_CENTS,
  MIN_TOPUP_CENTS,
  prepareCreditRequest,
  requireModelFunding,
  selectedCreditModel,
  TOPUP_FEE_CENTS,
  UUID,
} from "../_shared/ai-credits.ts";

// All compatible models are available by default; operators may restrict the
// paid catalogue. Model choice is explicit and usage never carries a markup.
const allowed = new Set(
  (Deno.env.get("FILEY_AI_MODELS") ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const packs = creditPacks(Deno.env.get("DODO_AI_CREDIT_PACKS") ?? "");
const customProduct = customCreditProduct(
  Deno.env.get("DODO_AI_CREDIT_PRODUCT_ID") ?? "",
);
let catalogue: { expires: number; models: CreditModel[] } | undefined;
let loading: Promise<CreditModel[]> | undefined;

async function models(): Promise<CreditModel[]> {
  if (catalogue && catalogue.expires > Date.now()) return catalogue.models;
  if (loading) return loading;
  loading = (async () => {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error("The model catalogue is temporarily unavailable.");
    }
    const body = await res.json();
    const list = creditModels(body.data, allowed);
    catalogue = { expires: Date.now() + 300000, models: list };
    return list;
  })().finally(() => {
    loading = undefined;
  });
  return loading;
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const { data: auth, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !auth.user) {
    return json(
      { error: "Sign in to your Filey account to use AI credits." },
      401,
    );
  }
  const user = auth.user;
  const wallet = async (action: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc("filey_ai_wallet", {
      p_action: action,
      p_user: user.id,
      p_args: args,
    });
    if (error) throw new Error(error.message);
    return data;
  };
  let reservation: string | undefined;
  try {
    if (Number(req.headers.get("content-length")) > 3_000_000) {
      return json(
        { error: "Attachments are too large. Use a smaller image." },
        413,
      );
    }
    const reader = req.body?.getReader(),
      decoder = new TextDecoder();
    let raw = "",
      bytes = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 3_000_000) {
            await reader.cancel();
            return json(
              { error: "Attachments are too large. Use a smaller image." },
              413,
            );
          }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error();
      }
    } catch {
      return json({ error: "Invalid JSON request." }, 400);
    }
    const action = body.action;
    if (action === "status" || action === "limits" || action === "history") {
      if (!(await rateLimit(admin, user.id, "ai_credits_read", 120, 3600))) {
        return json(
          { error: "Too many balance requests. Try again later." },
          429,
        );
      }
      if (action === "history") {
        const before = Number(body.before);
        if (!Number.isSafeInteger(before) || before <= 0) {
          return json({ error: "Invalid history cursor." }, 400);
        }
        const { data, error } = await admin
          .from("ai_credit_ledger")
          .select("id,kind,amount_micros,description,created_at")
          .eq("user_id", user.id)
          .lt("id", before)
          .order("id", { ascending: false })
          .limit(30);
        if (error) throw error;
        return json({ history: data });
      }
      if (action === "limits") {
        const task = Number(body.task_limit_micros),
          daily = Number(body.daily_limit_micros);
        if (
          ![task, daily].every(Number.isSafeInteger) ||
          task < 10000 ||
          task > 50000000 ||
          daily < 10000 ||
          daily > 100000000 ||
          task > daily
        ) {
          return json(
            {
              error:
                "Set a task limit from $0.01–$50 and a daily limit from the task limit to $100.",
            },
            400,
          );
        }
        return json({
          account: await wallet("limits", {
            task_limit_micros: task,
            daily_limit_micros: daily,
          }),
        });
      }
      const paidGateway = creditGateway(),
        freeGateway = creditGateway(true);
      const [account, history, catalogModels] = await Promise.all([
        wallet("status"),
        admin
          .from("ai_credit_ledger")
          .select("id,kind,amount_micros,description,created_at")
          .eq("user_id", user.id)
          .order("id", { ascending: false })
          .limit(30),
        // A chat-provider outage must not hide the wallet or block video usage.
        paidGateway || freeGateway
          ? models().catch(() => [])
          : Promise.resolve([]),
      ]);
      if (history.error) throw history.error;
      const availableModels = catalogModels.filter((model) =>
        model.free ? freeGateway : paidGateway
      );
      const configured = availableModels.length > 0;
      const videoConfigured = !!Deno.env.get("HF_API_KEY_ID") &&
        !!Deno.env.get("HF_API_KEY_SECRET");
      const walletReady = availableModels.some((model) => !model.free) ||
        videoConfigured;
      const paymentsReady = walletReady &&
        !!Deno.env.get("DODO_PAYMENTS_API_KEY");
      return json({
        account,
        history: history.data,
        models: availableModels,
        markup_bps: 0,
        topup_fee_cents: TOPUP_FEE_CENTS,
        free_requests_per_day: FREE_REQUESTS_PER_DAY,
        configured,
        video_configured: videoConfigured,
        packs: walletReady ? packs : [],
        topups_enabled: paymentsReady && (packs.length > 0 || !!customProduct),
        ...(paymentsReady && customProduct
          ? {
            custom_topup: {
              min_cents: MIN_TOPUP_CENTS,
              max_cents: MAX_TOPUP_CENTS,
            },
          }
          : {}),
        notice: configured
          ? null
          : videoConfigured
          ? "Video generation is connected. Managed chat models are still being set up; your own chat API key still works."
          : "Filey-funded AI is being set up. Your own API key still works.",
      });
    }
    if (action !== "completion") {
      return json({ error: "Unknown AI credits action." }, 400);
    }
    if (!creditGateway(body.funding === "free")) {
      return json(
        {
          error:
            "Filey-funded AI is not configured yet. Use your own API key for now.",
        },
        503,
      );
    }
    if (!user.email_confirmed_at) {
      return json(
        { error: "Verify your email before using Filey-hosted AI." },
        403,
      );
    }
    if (
      !UUID.test(String(body.request_id)) || !UUID.test(String(body.run_id))
    ) {
      return json({ error: "Invalid request identifier." }, 400);
    }
    const payload = body.request as Record<string, unknown>;
    const available = await models();
    let model: CreditModel;
    let prepared;
    try {
      model = selectedCreditModel(payload?.model, available);
      requireModelFunding(body.funding, model);
      prepared = prepareCreditRequest(payload, model);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    if (model.free) {
      // Shared provider quota is additional to this per-account allowance.
      if (
        !(await rateLimit(
          admin,
          user.id,
          "ai_free_day",
          FREE_REQUESTS_PER_DAY,
          86400,
        ))
      ) {
        return json(
          {
            error:
              "Your free AI request allowance is used up. Try again in 24 hours, bring your own key, or choose Filey Credits.",
          },
          429,
        );
      }
      if (
        !(await rateLimit(admin, "filey-openrouter", "ai_free_minute", 20, 60))
      ) {
        return json(
          {
            error:
              "Free AI is busy. Please try again in a minute. Your credits were not used.",
          },
          429,
        );
      }
    } else {
      try {
        await wallet("reserve", {
          request_id: body.request_id,
          run_id: body.run_id,
          model: model.id,
          amount_micros: prepared.reserve,
          markup_bps: 0,
        });
      } catch (e) {
        return json({ error: (e as Error).message }, 402);
      }
      reservation = String(body.request_id);
    }
    // Never retry a paid completion. The request ID remains consumed even if
    // the network fails. Client disconnect does not interrupt accounting.
    const gateway = creditGateway(!!model.free)!;
    const upstream = await fetch(gateway.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gateway.key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://app.gofiley.com",
        "X-Title": "Filey AI",
        ...(gateway.kind === "omniroute"
          ? { "X-OmniRoute-No-Cache": "true", "Cache-Control": "no-cache" }
          : {}),
      },
      body: JSON.stringify({
        ...prepared.request,
        ...(gateway.kind === "omniroute"
          ? {
            model: `openrouter/${model.id}`,
            user: body.request_id,
          }
          : {}),
      }),
      signal: AbortSignal.timeout(120000),
      redirect: "error",
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      if (reservation) await wallet("release", { request_id: reservation });
      reservation = undefined;
      return json(
        {
          error:
            model.free && (upstream.status === 429 || upstream.status === 402)
              ? "The shared free AI allowance is unavailable or exhausted. Try later, bring your own key, or select Filey Credits. Your credits were not used."
              : upstream.status === 429
              ? "This model is busy. No Filey credits were charged; try again shortly."
              : "The model could not complete this request. No Filey credits were charged.",
        },
        upstream.status === 429 ? 429 : 502,
      );
    }
    const completion = await upstream.json();
    if (completion.error || !completion.choices?.[0]?.message) {
      throw new Error(
        "The provider did not return verifiable usage. No Filey credits were charged.",
      );
    }
    const usage = gateway.kind === "omniroute"
      ? await gatewayReceipt(completion.id, model.id, String(body.request_id))
      : completion.usage;
    if (typeof usage?.cost !== "number") {
      throw new Error(
        "The provider did not return verifiable usage. No Filey credits were charged.",
      );
    }
    if (model.free) {
      if (usage.cost !== 0) {
        throw new Error(
          "The provider returned unexpected pricing. No Filey credits were charged.",
        );
      }
      return json({ completion, charged_micros: 0 });
    }
    const cost = chargedMicros(usage.cost);
    const tokens = (
      n: unknown,
    ) => (Number.isSafeInteger(n) && Number(n) >= 0 ? n : null);
    const account = await wallet("settle", {
      request_id: reservation,
      charged_micros: cost,
      provider_cost_micros: cost,
      provider_id: completion.id,
      input_tokens: tokens(usage.prompt_tokens),
      output_tokens: tokens(usage.completion_tokens),
    });
    reservation = undefined;
    return json({
      completion: { ...completion, model: model.id },
      account,
      charged_micros: Math.min(cost, prepared.reserve),
    });
  } catch (e) {
    if (reservation) {
      try {
        await wallet("release", { request_id: reservation });
      } catch {
        console.error(
          "AI credit reservation needs expiry reconciliation",
          reservation,
        );
      }
    }
    // Never surface provider payloads/keys or user prompts in logs.
    const message = e instanceof Error ? e.message : "";
    return json(
      {
        error: message.includes("No Filey credits were charged")
          ? message
          : "AI credits are temporarily unavailable. Refresh your balance before trying again.",
      },
      503,
    );
  }
}

if (import.meta.main) Deno.serve(handleRequest);
