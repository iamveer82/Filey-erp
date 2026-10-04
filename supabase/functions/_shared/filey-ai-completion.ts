import { creditGateway } from "./ai-credit-gateway.ts";
import { type CreditModel, prepareCreditRequest, UUID } from "./ai-credits.ts";

export const FILEY_AI_MODEL_ID = "filey-ai";
export const FILEY_AI_UPSTREAM_MODEL = "deepseek-flash";

/** DeepSeek V4.1 Flash, official rates verified 2026-10-03.
 * https://api-docs.deepseek.com/quick_start/pricing
 * Apply Filey's fixed 5/3 tariff to the published off-peak base rates:
 * $0.005/M cached, $0.25/M uncached, $1.00/M output. Reserve at scaled peak
 * bounds ($0.50/M input, $2.00/M output), without guessing Chinese holidays.
 * Keep Filey's existing context/output safety caps, independent of provider caps. */
export const FILEY_AI_MODEL: Readonly<CreditModel> = Object.freeze({
  id: FILEY_AI_MODEL_ID,
  name: "Filey AI",
  // Public uncached input/output rates reflect the customer's actual tariff.
  input: 0.25 / 1_000_000,
  output: 1.00 / 1_000_000,
  context: 131072,
  maxOutput: 8192,
  vision: true,
  reasoning: true,
  free: false,
});
const RESERVATION_MODEL: Readonly<CreditModel> = Object.freeze({
  ...FILEY_AI_MODEL,
  input: 0.50 / 1_000_000,
  output: 2.00 / 1_000_000,
});

export type CreditWallet = (
  action: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
export type FileyAIUser = { id: string; email_confirmed_at?: string | null };
export type FileyAIMessage = {
  role: "assistant";
  content: string | null;
  reasoning_content?: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};

export class FileyAIError extends Error {
  constructor(message: string, public readonly status = 503) {
    super(message);
    this.name = "FileyAIError";
  }
}
const USAGE_ERROR =
  "Filey AI did not return verifiable usage. No Coins were charged.";
const BILLING_ERROR =
  "Coins are temporarily unavailable. Refresh your balance before trying again.";

/** The only public managed model is an alias. Never accept an upstream model,
 * provider URL, fallback, caller pricing, or provider key from a request. */
export function prepareFileyAIRequest(payload: Record<string, unknown>) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new FileyAIError("Invalid Filey AI request.", 400);
  }
  if (payload.model !== undefined && payload.model !== FILEY_AI_MODEL_ID) {
    throw new FileyAIError("Select Filey AI to use Coins.", 400);
  }
  let prepared;
  try {
    prepared = prepareCreditRequest(payload, RESERVATION_MODEL);
  } catch (error) {
    throw new FileyAIError((error as Error).message, 400);
  }
  const effort = payload.reasoning_effort;
  if (
    effort !== undefined &&
    !["auto", "low", "medium", "high", "xhigh", "max"].includes(String(effort))
  ) {
    throw new FileyAIError("Choose a supported reasoning level.", 400);
  }
  // DeepSeek requires the exact reasoning from earlier tool turns. Reject an
  // incompatible old-provider continuation before reserving or sending it.
  for (const source of prepared.request.messages) {
    const message = source as Record<string, unknown>;
    if (
      message.role === "assistant" && Array.isArray(message.tool_calls) &&
      message.tool_calls.length &&
      typeof message.reasoning_content !== "string"
    ) {
      throw new FileyAIError(
        "This conversation cannot be continued with Filey AI. Start a new chat.",
        400,
      );
    }
  }
  const messages = prepared.request.messages.map((message) => {
    const clean = { ...message } as Record<string, unknown>;
    delete clean.reasoning;
    delete clean.reasoning_details;
    return clean;
  });
  return {
    reserve: prepared.reserve,
    request: {
      model: FILEY_AI_UPSTREAM_MODEL,
      messages,
      ...(prepared.request.tools ? { tools: prepared.request.tools } : {}),
      stream: false,
      max_tokens: prepared.request.max_tokens,
      thinking: { type: "enabled" },
      reasoning_effort: effort === "max"
        ? "max"
        : ["medium", "high", "xhigh"].includes(String(effort))
        ? "high"
        : "low",
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Apply the server's exact 5/3 tariff before one micro-dollar ceiling. Never
 * round the base cost first or charge reasoning twice: it is already included
 * in completion tokens. Supplier cost fields and caller prices are untrusted. */
export function fileyAIUsage(completion: unknown, maxTokens: number) {
  if (
    !record(completion) || completion.error ||
    completion.model !== FILEY_AI_UPSTREAM_MODEL ||
    typeof completion.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(completion.id) ||
    !record(completion.usage)
  ) throw new FileyAIError(USAGE_ERROR);
  const usage = completion.usage;
  const prompt = usage.prompt_tokens,
    output = usage.completion_tokens,
    hit = usage.prompt_cache_hit_tokens,
    miss = usage.prompt_cache_miss_tokens,
    total = usage.total_tokens;
  if (
    ![prompt, output, hit, miss, total].every(tokenCount) ||
    Number(hit) + Number(miss) !== prompt ||
    Number(prompt) + Number(output) !== total ||
    Number(prompt) + maxTokens > FILEY_AI_MODEL.context ||
    Number(output) > maxTokens ||
    !Number.isSafeInteger(maxTokens) || maxTokens < 1 ||
    maxTokens > FILEY_AI_MODEL.maxOutput
  ) {
    throw new FileyAIError(USAGE_ERROR);
  }
  const details = usage.completion_tokens_details;
  if (
    details !== undefined && details !== null &&
    (!record(details) ||
      (details.reasoning_tokens !== undefined &&
        (!tokenCount(details.reasoning_tokens) ||
          Number(details.reasoning_tokens) > Number(output))))
  ) {
    throw new FileyAIError(USAGE_ERROR);
  }
  const milliMicros = BigInt(Number(hit)) * 3n +
    BigInt(Number(miss)) * 150n + BigInt(Number(output)) * 600n;
  const chargedMicros = Number((milliMicros * 5n + 2999n) / 3000n);
  return {
    chargedMicros,
    inputTokens: Number(prompt),
    outputTokens: Number(output),
  };
}

function publicMessage(completion: unknown): FileyAIMessage {
  if (
    !record(completion) || !Array.isArray(completion.choices) ||
    completion.choices.length !== 1 || !record(completion.choices[0]) ||
    !record(completion.choices[0].message)
  ) throw new FileyAIError(USAGE_ERROR);
  const message = completion.choices[0].message;
  if (
    message.role !== "assistant" ||
    !(typeof message.content === "string" || message.content === null) ||
    (typeof message.content === "string" && message.content.length > 262144) ||
    (message.reasoning_content !== undefined &&
      message.reasoning_content !== null &&
      (typeof message.reasoning_content !== "string" ||
        message.reasoning_content.length > 262144))
  ) {
    throw new FileyAIError(USAGE_ERROR);
  }
  const calls = message.tool_calls;
  if (
    calls !== undefined &&
    (!Array.isArray(calls) || calls.length > 64 ||
      calls.some((call) =>
        !record(call) || typeof call.id !== "string" || call.id.length > 200 ||
        call.type !== "function" || !record(call.function) ||
        typeof call.function.name !== "string" ||
        call.function.name.length > 128 ||
        typeof call.function.arguments !== "string" ||
        call.function.arguments.length > 262144
      ))
  ) throw new FileyAIError(USAGE_ERROR);
  if (
    !(typeof message.content === "string" && message.content.trim()) &&
    !(Array.isArray(calls) && calls.length)
  ) {
    throw new FileyAIError(
      "Filey AI could not finish a reply. No Coins were charged. Try a shorter request or a lower reasoning level.",
      502,
    );
  }
  if (
    Array.isArray(calls) && calls.length &&
    typeof message.reasoning_content !== "string"
  ) throw new FileyAIError(USAGE_ERROR);
  return {
    role: "assistant",
    content: message.content as string | null,
    ...(message.reasoning_content !== undefined
      ? { reasoning_content: message.reasoning_content as string | null }
      : {}),
    ...(Array.isArray(calls)
      ? {
        tool_calls: calls.map((call) => ({
          id: call.id as string,
          type: "function" as const,
          function: {
            name: call.function.name as string,
            arguments: call.function.arguments as string,
          },
        })),
      }
      : {}),
  };
}

function walletMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    message ===
      "Not enough available AI credits for this request. Add credits or lower the output limit."
  ) {
    return "Insufficient credit. Add Coin to continue.";
  }
  // Only Filey's known wallet denials are safe for normal chat. SQL/provider
  // details or arbitrary exception text must not disclose credentials or rows.
  const safe = [
    "This request was already submitted. Refresh your balance before retrying.",
    "AI credits are paused while a payment dispute is reviewed.",
    "AI request limit reached. Wait a minute.",
  ];
  return safe.includes(message) ? message : BILLING_ERROR;
}

/** Server-only service shared by JWT-authenticated chat and authenticated
 * channel webhooks. Callers bind wallet to the verified user and enforce org,
 * role and MFA policy before calling; no service-role impersonation endpoint. */
export async function fileyAICompletion(
  { user, wallet, requestId, runId, request, timeoutMs = 120000 }: {
    user: FileyAIUser;
    wallet: CreditWallet;
    requestId: string;
    runId: string;
    request: Record<string, unknown>;
    timeoutMs?: number;
  },
) {
  if (!user || !UUID.test(user.id) || !user.email_confirmed_at) {
    throw new FileyAIError("Verify your email before using Filey AI.", 403);
  }
  if (!UUID.test(requestId) || !UUID.test(runId)) {
    throw new FileyAIError("Invalid request identifier.", 400);
  }
  const prepared = prepareFileyAIRequest(request);
  const gateway = creditGateway();
  if (!gateway) {
    throw new FileyAIError(
      "Filey AI is being set up. Your own API key still works.",
    );
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new FileyAIError("Invalid Filey AI request.", 400);
  }
  try {
    await wallet("reserve", {
      request_id: requestId,
      run_id: runId,
      model: FILEY_AI_MODEL_ID,
      amount_micros: prepared.reserve,
      // The fixed tariff is already included in reserve/settle amounts.
      markup_bps: 0,
    });
  } catch (error) {
    throw new FileyAIError(walletMessage(error), 402);
  }
  let settled = false;
  try {
    // Do not retry inference, follow redirects or attach client cancellation:
    // one consumed UUID means at most one provider call, even after timeout.
    const response = await fetch(gateway.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gateway.key}`,
        "Content-Type": "application/json",
      },
      // Provider KV-cache/scheduling isolation is bound to the verified account,
      // never a caller-supplied identity, email, or another workspace's owner.
      body: JSON.stringify({ ...prepared.request, user_id: user.id }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new FileyAIError(
        response.status === 429
          ? "Filey AI is busy. No Coins were charged; try again shortly."
          : "Filey AI could not complete this request. No Coins were charged.",
        response.status === 429 ? 429 : 502,
      );
    }
    const raw: unknown = await response.json();
    const usage = fileyAIUsage(raw, prepared.request.max_tokens);
    const message = publicMessage(raw);
    const source = raw as Record<string, unknown>;
    const account = await wallet("settle", {
      request_id: requestId,
      charged_micros: usage.chargedMicros,
      // Token billing is verified; actual supplier peak/holiday cost is not.
      provider_cost_micros: null,
      provider_id: source.id,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
    });
    settled = true;
    return {
      completion: {
        id: source.id as string,
        object: "chat.completion",
        model: FILEY_AI_MODEL_ID,
        choices: [{
          index: 0,
          message,
          finish_reason: [
              "stop",
              "length",
              "tool_calls",
              "content_filter",
              "insufficient_system_resource",
            ].includes(
              String(
                (source.choices as Record<string, unknown>[])[0]
                  .finish_reason,
              ),
            )
            ? (source.choices as Record<string, unknown>[])[0]
              .finish_reason as string
            : null,
        }],
        usage: {
          prompt_tokens: usage.inputTokens,
          completion_tokens: usage.outputTokens,
          total_tokens: usage.inputTokens + usage.outputTokens,
        },
      },
      account,
      charged_micros: Math.min(usage.chargedMicros, prepared.reserve),
    };
  } catch (error) {
    if (!settled) {
      try {
        await wallet("release", { request_id: requestId });
      } catch {
        // A lost settlement ack is also safe: the wallet release is idempotent
        // and cannot refund settled usage. Uncertain holds expire atomically.
        console.error(
          "AI credit reservation needs expiry reconciliation",
          requestId,
        );
      }
    }
    if (error instanceof FileyAIError) throw error;
    throw new FileyAIError(BILLING_ERROR);
  }
}
