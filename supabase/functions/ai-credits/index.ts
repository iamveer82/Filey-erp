import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MFA_REQUIRED, mfaAllowed } from "../_shared/mfa.ts";
import { CORS_HEADERS, json, rateLimit } from "../_shared/rateLimit.ts";
import { creditGateway } from "../_shared/ai-credit-gateway.ts";
import { creditPaymentsReady } from "../_shared/ai-credit-payments.ts";
import { isAuthorizedZeroCreditOrder, publicTestPromotion } from "../_shared/ai-credit-promotion.ts";
import {
  FILEY_AI_MODEL,
  fileyAICompletion,
  FileyAIError,
} from "../_shared/filey-ai-completion.ts";
import {
  creditPacks,
  customCreditProduct,
  MAX_TOPUP_CENTS,
  MIN_TOPUP_CENTS,
  TOPUP_FEE_CENTS,
  UUID,
} from "../_shared/ai-credits.ts";

// Filey-provided chat has one public alias; provider/model credentials stay server-side.
const packs = creditPacks(Deno.env.get("DODO_AI_CREDIT_PACKS") ?? "");
const customProduct = customCreditProduct(
  Deno.env.get("DODO_AI_CREDIT_PRODUCT_ID") ?? "",
);
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
  if (!mfaAllowed(user, jwt)) return json(MFA_REQUIRED, 403);
  const wallet = async (action: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc("filey_ai_wallet", {
      p_action: action,
      p_user: user.id,
      p_args: args,
    });
    if (error) throw new Error(error.message);
    return data;
  };
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
    if (action === "limits") {
      return json({
        error:
          "Spending limits are no longer used. Coin usage uses your available balance.",
      }, 400);
    }
    if (action === "checkout_status") {
      const orderId = body.order_id;
      // Length also rejects a trailing newline accepted by JavaScript's `$`.
      if (typeof orderId !== "string" || orderId.length !== 36 || !UUID.test(orderId)) {
        return json({ error: "Invalid Coin order." }, 400);
      }
      if (!(await rateLimit(admin, user.id, "ai_credits_read", 120, 3600))) {
        return json({ error: "Too many balance requests. Try again later." }, 429);
      }
      // Orders remain service-only. An unknown and another user's order are
      // indistinguishable; payment/wallet state is never inferred from a URL.
      const { data: order, error } = await admin
        .from("ai_credit_orders")
        .select("payment_id,paid_cents,credits_micros,refunded_micros,disputed,promotion_id,promotion_discount_id,promotion_discount_code,promotion_customer_id,promotion_email,promotion_expires_at,expected_paid_cents,checkout_session_id,service_fee_cents")
        .eq("id", orderId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      const confirmed = !!order &&
        typeof order.payment_id === "string" && !!order.payment_id.trim() &&
        Number.isSafeInteger(order.paid_cents) && (order.paid_cents > 0 ||
          (order.paid_cents === 0 && isAuthorizedZeroCreditOrder(order))) &&
        Number.isSafeInteger(order.credits_micros) && order.credits_micros > 0 &&
        Number.isSafeInteger(order.refunded_micros) && order.refunded_micros >= 0 &&
        order.refunded_micros < order.credits_micros && order.disputed === false;
      return json({ confirmed });
    }
    if (action === "status" || action === "history") {
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
      const configured = !!creditGateway();
      const [account, history] = await Promise.all([
        wallet("status"),
        admin
          .from("ai_credit_ledger")
          .select("id,kind,amount_micros,description,created_at")
          .eq("user_id", user.id)
          .order("id", { ascending: false })
          .limit(30),
      ]);
      if (history.error) throw history.error;
      const availableModels = configured ? [FILEY_AI_MODEL] : [];
      const walletReady = availableModels.some((model) => !model.free);
      const paymentsReady = walletReady && creditPaymentsReady();
      const testPromotion = paymentsReady ? await publicTestPromotion(admin, user) : undefined;
      return json({
        account,
        history: history.data,
        models: availableModels,
        markup_bps: 0,
        topup_fee_cents: TOPUP_FEE_CENTS,
        free_requests_per_day: 0,
        configured,
        video_configured: false,
        packs: walletReady ? packs : [],
        topups_enabled: paymentsReady && (packs.length > 0 || !!customProduct),
        ...(testPromotion ? { test_promotion: testPromotion } : {}),
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
          : "Filey-funded AI is being set up. Your own API key still works.",
      });
    }
    if (action !== "completion") {
      return json({ error: "Unknown AI credits action." }, 400);
    }
    if (body.funding !== "credits") {
      return json({
        error: "Use Coins for Filey AI, or connect your own API key.",
      }, 400);
    }
    const result = await fileyAICompletion({
      user,
      wallet,
      requestId: String(body.request_id),
      runId: String(body.run_id),
      request: body.request as Record<string, unknown>,
    });
    return json(result);
  } catch (error) {
    if (error instanceof FileyAIError) {
      return json({ error: error.message }, error.status);
    }
    // Never surface provider payloads/keys or user prompts in logs.
    return json({
      error:
        "Coins are temporarily unavailable. Refresh your balance before trying again.",
    }, 503);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
