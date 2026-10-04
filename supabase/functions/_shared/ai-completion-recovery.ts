import {
  creditGateway,
} from "./ai-credit-gateway.ts";
import {
  fileyAICompletion,
  FILEY_AI_MODEL_ID,
  FileyAIError,
  type FileyAIUser,
  prepareFileyAIRequest,
} from "./filey-ai-completion.ts";
import { UUID } from "./ai-credits.ts";

type RecoveryRpc = (action: string, args: Record<string, unknown>) => Promise<unknown>;
type RecoveryResult = {
  state: "pending" | "complete" | "failed" | "missing";
  dispatch?: boolean;
  completion?: unknown;
  account?: unknown;
  charged_micros?: number;
  message?: string;
};

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && UUID.test(value);
}
function workspace(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32);
}
async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** JWT callers bind this RPC to the verified account. RPC also checks current
 * profile AND membership against the original organization on every read.
 * The prompt stays only in worker memory; only the verified result is cached.
 * This path is opt-in for cloud mode. Local/BYOK requests never enter it. */
export async function recoverFileyAICompletion(
  user: FileyAIUser,
  body: Record<string, unknown>,
  rpc: RecoveryRpc,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<RecoveryResult> {
  if (!identifier(user.id) || !user.email_confirmed_at) {
    throw new FileyAIError("Verify your email before using Filey AI.", 403);
  }
  if (!identifier(body.request_id) || !workspace(body.org_id)) {
    throw new FileyAIError("Invalid AI request.", 400);
  }
  const binding = { request_id: body.request_id, org_id: body.org_id };
  if (body.action === "completion_status") {
    return await rpc("status", binding) as RecoveryResult;
  }
  if (body.action !== "completion" || body.recoverable !== true ||
    body.funding !== "credits" || !identifier(body.run_id)) {
    throw new FileyAIError("Invalid AI request.", 400);
  }
  const request = body.request as Record<string, unknown>;
  const prepared = prepareFileyAIRequest(request);
  if (!creditGateway()) throw new FileyAIError("Filey AI is being set up. Your own API key still works.");
  const args = {
    ...binding,
    run_id: body.run_id,
    fingerprint: await fingerprint(prepared.request),
    model: FILEY_AI_MODEL_ID,
    amount_micros: prepared.reserve,
    markup_bps: 0,
  };
  let job: RecoveryResult;
  try {
    job = await rpc("begin", args) as RecoveryResult;
  } catch (error) {
    // Only known wallet denials belong in the public chat.
    const message = error instanceof Error ? error.message : "";
    if (message === "Not enough available AI credits for this request. Add credits or lower the output limit.")
      throw new FileyAIError("Insufficient credit. Add Coin to continue.", 402);
    if (["AI request limit reached. Wait a minute.", "AI credits are paused while a payment dispute is reviewed."].includes(message))
      throw new FileyAIError(message, 402);
    throw new FileyAIError("Your AI wallet is temporarily unavailable. Please try again shortly.");
  }
  if (!job.dispatch) return job;
  const work = (async () => {
    try {
      await fileyAICompletion({
        user,
        requestId: body.request_id as string,
        runId: body.run_id as string,
        request,
        wallet: async (action, values = {}) => {
          // The begin RPC already reserved the exact prepared request. Never
          // attempt reserve a second time and never retry provider inference.
          if (action === "reserve") return null;
          return await rpc(action === "settle" ? "settle" : "fail", { ...values, ...binding });
        },
      });
    } catch {
      // Safe to repeat after an uncertain settlement ack: complete results
      // cannot be released/refunded or overwritten by a later failure.
      try { await rpc("fail", binding); } catch { /* Hold expires without charging uncertain work. */ }
    }
  })();
  if (waitUntil) {
    waitUntil(work);
    return { state: "pending" };
  }
  // Tests/ordinary Deno serving don't expose the EdgeRuntime lifecycle hook.
  await work;
  return await rpc("status", binding) as RecoveryResult;
}
