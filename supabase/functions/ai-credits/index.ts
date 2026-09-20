import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS, json, rateLimit } from "../_shared/rateLimit.ts";
import {
  chargedMicros,
  creditPacks,
  markupBps,
  prepareCreditRequest,
  UUID,
  type CreditModel,
} from "../_shared/ai-credits.ts";

const apiKey = Deno.env.get("FILEY_AI_OPENROUTER_KEY") ?? "";
const markup = markupBps(Deno.env.get("FILEY_AI_MARKUP_BPS"));
const allowed = new Set(
  (
    Deno.env.get("FILEY_AI_MODELS") ??
    "openai/gpt-4.1-mini,openai/gpt-4.1,anthropic/claude-sonnet-4,google/gemini-2.5-flash,google/gemini-2.5-pro"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const packs = creditPacks(Deno.env.get("DODO_AI_CREDIT_PACKS") ?? "");
let catalogue: { expires: number; models: CreditModel[] } | undefined;
let loading: Promise<CreditModel[]> | undefined;

async function models(): Promise<CreditModel[]> {
  if (catalogue && catalogue.expires > Date.now()) return catalogue.models;
  if (loading) return loading;
  loading = (async () => {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error("The model catalogue is temporarily unavailable.");
    const body = await res.json();
    const list: CreditModel[] = [];
    for (const m of body.data ?? []) {
      if (!allowed.has(m.id) || !m.supported_parameters?.includes("tools")) continue;
      const input = Number(m.pricing?.prompt),
        output = Number(m.pricing?.completion);
      // Exclude models with extra request/image/search/audio charges. Supported
      // vision models bill their image input as prompt tokens.
      if (
        ![input, output].every((n) => Number.isFinite(n) && n >= 0) ||
        input + output <= 0 ||
        Object.entries(m.pricing ?? {}).some(
          ([k, v]) =>
            !["prompt", "completion", "input_cache_read", "input_cache_write"].includes(
              k
            ) && Number(v) > 0
        )
      )
        continue;
      const context = Math.min(Number(m.context_length), 131072);
      const maxOutput = Math.min(
        Number(m.top_provider?.max_completion_tokens) || 8192,
        8192,
        context - 1024
      );
      if (!Number.isInteger(context) || context < 2048 || maxOutput < 1) continue;
      list.push({
        id: m.id,
        name: m.name,
        input,
        output,
        context,
        maxOutput,
        vision: !!m.architecture?.input_modalities?.includes("image"),
      });
    }
    catalogue = { expires: Date.now() + 300000, models: list };
    return list;
  })().finally(() => {
    loading = undefined;
  });
  return loading;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: auth, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !auth.user)
    return json({ error: "Sign in to your Filey account to use AI credits." }, 401);
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
    if (Number(req.headers.get("content-length")) > 3_000_000)
      return json({ error: "Attachments are too large. Use a smaller image." }, 413);
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
              413
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
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    } catch {
      return json({ error: "Invalid JSON request." }, 400);
    }
    const action = body.action;
    if (action === "status" || action === "limits" || action === "history") {
      if (!(await rateLimit(admin, user.id, "ai_credits_read", 120, 3600)))
        return json({ error: "Too many balance requests. Try again later." }, 429);
      if (action === "history") {
        const before = Number(body.before);
        if (!Number.isSafeInteger(before) || before <= 0)
          return json({ error: "Invalid history cursor." }, 400);
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
        )
          return json(
            {
              error:
                "Set a task limit from $0.01–$50 and a daily limit from the task limit to $100.",
            },
            400
          );
        return json({
          account: await wallet("limits", {
            task_limit_micros: task,
            daily_limit_micros: daily,
          }),
        });
      }
      const [account, history, availableModels] = await Promise.all([
        wallet("status"),
        admin
          .from("ai_credit_ledger")
          .select("id,kind,amount_micros,description,created_at")
          .eq("user_id", user.id)
          .order("id", { ascending: false })
          .limit(30),
        apiKey ? models() : Promise.resolve([]),
      ]);
      if (history.error) throw history.error;
      const configured = !!apiKey && availableModels.length > 0;
      return json({
        account,
        history: history.data,
        models: availableModels,
        markup_bps: markup,
        configured,
        packs: configured ? packs : [],
        topups_enabled:
          configured && packs.length > 0 && !!Deno.env.get("DODO_PAYMENTS_API_KEY"),
        notice: configured
          ? null
          : "Filey-funded AI is being set up. Your own API key still works.",
      });
    }
    if (action !== "completion")
      return json({ error: "Unknown AI credits action." }, 400);
    if (!apiKey)
      return json(
        { error: "Filey-funded AI is not configured yet. Use your own API key for now." },
        503
      );
    if (!user.email_confirmed_at)
      return json({ error: "Verify your email before spending AI credits." }, 403);
    if (!UUID.test(String(body.request_id)) || !UUID.test(String(body.run_id)))
      return json({ error: "Invalid request identifier." }, 400);
    const payload = body.request as Record<string, unknown>;
    const model = (await models()).find((m) => m.id === payload?.model);
    if (!model)
      return json(
        {
          error:
            "This model is not in the Filey Credits catalogue. Choose an available model.",
        },
        400
      );
    let prepared;
    try {
      prepared = prepareCreditRequest(payload, model, markup);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    try {
      await wallet("reserve", {
        request_id: body.request_id,
        run_id: body.run_id,
        model: model.id,
        amount_micros: prepared.reserve,
        markup_bps: markup,
      });
    } catch (e) {
      return json({ error: (e as Error).message }, 402);
    }
    reservation = String(body.request_id);
    // Never retry a paid completion. The request ID remains consumed even if
    // the network fails. Client disconnect does not interrupt accounting.
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://app.gofiley.com",
        "X-Title": "Filey AI",
      },
      body: JSON.stringify(prepared.request),
      signal: AbortSignal.timeout(120000),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      await wallet("release", { request_id: reservation });
      reservation = undefined;
      return json(
        {
          error:
            upstream.status === 429
              ? "This model is busy. No Filey credits were charged; try again shortly."
              : "The model could not complete this request. No Filey credits were charged.",
        },
        502
      );
    }
    const completion = await upstream.json();
    if (!completion.choices?.[0]?.message || typeof completion.usage?.cost !== "number")
      throw new Error(
        "The provider did not return verifiable usage. No Filey credits were charged."
      );
    const cost = chargedMicros(completion.usage.cost, markup);
    const tokens = (n: unknown) => (Number.isSafeInteger(n) && Number(n) >= 0 ? n : null);
    const account = await wallet("settle", {
      request_id: reservation,
      charged_micros: cost,
      provider_cost_micros: chargedMicros(completion.usage.cost, 0),
      provider_id: completion.id,
      input_tokens: tokens(completion.usage.prompt_tokens),
      output_tokens: tokens(completion.usage.completion_tokens),
    });
    reservation = undefined;
    return json({
      completion,
      account,
      charged_micros: Math.min(cost, prepared.reserve),
    });
  } catch (e) {
    if (reservation) {
      try {
        await wallet("release", { request_id: reservation });
      } catch {
        console.error("AI credit reservation needs expiry reconciliation", reservation);
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
      503
    );
  }
});
