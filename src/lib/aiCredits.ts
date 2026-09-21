import { supabase } from "./supabase";
import { serviceError } from "./serviceError";
import { paymentUrl } from "./billingService";
import { agentStorageScope, readAgentStorage, writeAgentStorage } from "./agentStorage";

export const AI_CREDITS_EVENT = "filey:ai-credits";
export type AiFunding = "byok" | "credits" | "free";
export interface CreditModel {
  id: string;
  name: string;
  input: number;
  output: number;
  context: number;
  maxOutput: number;
  vision: boolean;
  free?: boolean;
}
export interface CreditAccount {
  balance_micros: number;
  reserved_micros: number;
  available_micros: number;
  task_limit_micros: number;
  daily_limit_micros: number;
  blocked: boolean;
}
export interface CreditEntry {
  id: number;
  kind: "topup" | "usage" | "refund";
  amount_micros: number;
  description: string;
  created_at: string;
}
export interface CreditStatus {
  account: CreditAccount;
  history: CreditEntry[];
  models: CreditModel[];
  packs: { id: string; cents: number }[];
  markup_bps: number;
  topup_fee_cents?: number;
  free_requests_per_day?: number;
  configured: boolean;
  video_configured?: boolean;
  topups_enabled: boolean;
  notice: string | null;
}
export const creditMoney = (micros: number, detailed = false) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: detailed ? 6 : 2,
  }).format(micros / 1_000_000);
export function creditChoice(): { funding: AiFunding; model: string } {
  try {
    const value = JSON.parse(readAgentStorage("filey.ai.funding") ?? "{}");
    return {
      funding:
        value.funding === "credits" || value.funding === "free" ? value.funding : "byok",
      model: typeof value.model === "string" ? value.model : "",
    };
  } catch {
    return { funding: "byok", model: "" };
  }
}
export function setCreditChoice(funding: AiFunding, model = creditChoice().model) {
  if (funding !== "byok" && !model) throw new Error("Choose a Filey AI model first.");
  writeAgentStorage("filey.ai.funding", JSON.stringify({ funding, model }));
  window.dispatchEvent(new Event(AI_CREDITS_EVENT));
}

export async function aiAccountSession() {
  if (!supabase) throw new Error("Connect your Filey account to use AI credits.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session)
    throw new Error(
      "Sign in to your cloud account to use AI credits. Your device records stay on this device."
    );
  return data.session;
}
const accountSession = aiAccountSession;
export async function callAiService<T>(
  name: string,
  body: Record<string, unknown>,
  expectedUser?: string
): Promise<T> {
  const session = await accountSession();
  if (expectedUser && session.user.id !== expectedUser)
    throw new Error("Your account changed. Start a new task.");
  // No automatic retries for anything that might charge money or call a model.
  const { data, error } = await supabase!.functions.invoke(name, { body });
  if (error) {
    throw await serviceError(error, "Your AI wallet is temporarily unavailable. Please try again shortly.");
  }
  if (data?.error) throw await serviceError(new Error(data.error), "Your AI wallet is temporarily unavailable. Please try again shortly.");
  const current = await accountSession();
  if (current.user.id !== session.user.id)
    throw new Error("Your account changed. Refresh AI Credits.");
  return data as T;
}
const call = callAiService;
let cached: { user: string; value: CreditStatus; expires: number } | undefined;
export function invalidateCreditStatus() {
  cached = undefined;
  window.dispatchEvent(new Event(AI_CREDITS_EVENT));
}
export async function getCreditStatus(force = false): Promise<CreditStatus> {
  const session = await accountSession();
  if (!force && cached?.user === session.user.id && cached.expires > Date.now())
    return cached.value;
  const value = await call<CreditStatus>(
    "ai-credits",
    { action: "status" },
    session.user.id
  );
  cached = { user: session.user.id, value, expires: Date.now() + 60000 };
  return value;
}
export async function saveCreditLimits(task: number, daily: number) {
  const result = await call<{ account: CreditAccount }>("ai-credits", {
    action: "limits",
    task_limit_micros: Math.round(task * 1e6),
    daily_limit_micros: Math.round(daily * 1e6),
  });
  cached = undefined;
  window.dispatchEvent(new Event(AI_CREDITS_EVENT));
  return result.account;
}
export async function creditHistory(before: number) {
  return (
    await call<{ history: CreditEntry[] }>("ai-credits", { action: "history", before })
  ).history;
}
export async function buyAiCredits(packId: string) {
  const { url } = await call<{ url: string }>("dodo", {
    action: "checkout_ai_credits",
    pack_id: packId,
  });
  paymentUrl(url);
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.location.assign(url);
}

/** One closure per task; delegated rounds share its server-enforced budget.
 * Choice changes apply to the next task. Never fall back to credits from BYOK. */
export function createCreditFetch(funding: "credits" | "free" = "credits") {
  const runId = crypto.randomUUID(),
    scope = agentStorageScope();
  let owner: Awaited<ReturnType<typeof accountSession>> | undefined;
  return async (_url: string, init: RequestInit): Promise<Response> => {
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (scope !== agentStorageScope())
      throw new Error("Your workspace changed. Start a new task.");
    const session = (owner ??= await accountSession());
    const result = await call<{
      completion: unknown;
      account?: CreditAccount;
      charged_micros: number;
    }>(
      "ai-credits",
      {
        action: "completion",
        funding,
        run_id: runId,
        request_id: crypto.randomUUID(),
        request: JSON.parse(String(init.body)),
      },
      session.user.id
    );
    // A stopped turn can have billable provider usage. Settle it, then stop
    // before any model output can execute another tool.
    if (result.account && cached?.user === session.user.id)
      cached = {
        ...cached,
        value: { ...cached.value, account: result.account },
        expires: 0,
      };
    window.dispatchEvent(new Event(AI_CREDITS_EVENT));
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (scope !== agentStorageScope())
      throw new Error("Your workspace changed. Start a new task.");
    return new Response(JSON.stringify(result.completion), {
      headers: { "content-type": "application/json" },
    });
  };
}
