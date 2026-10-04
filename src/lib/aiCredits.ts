import { supabase } from "./supabase";
import { serviceError } from "./serviceError";
import { BILLING_UNAVAILABLE, openBilling } from "./billingService";
import { AGENT_STORAGE_EVENT, agentStorageScope, readAgentStorage, writeAgentStorage } from "./agentStorage";
import { getCacheOrg, getCacheScope } from "./api";

export const AI_CREDITS_EVENT = "filey:ai-credits";
export const FILEY_AI_MODEL = "filey-ai";
export type AiFunding = "byok" | "credits" | "free";
export interface CreditModel {
  id: string;
  name: string;
  input: number;
  output: number;
  image?: number;
  context: number;
  maxOutput: number;
  vision: boolean;
  free?: boolean;
}
export const isPaidCreditModel = (model: CreditModel) =>
  !model.free && model.id === FILEY_AI_MODEL;
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
  custom_topup?: { min_cents: number; max_cents: number };
  test_promotion?: { id: string; cents: number; discount_cents: number; expires_at: string };
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
// Coin is a display unit only: 1 Coin = $1. The ledger stays in USD micros.
export const creditCoin = (micros: number, detailed = false) =>
  `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: detailed ? 6 : 2,
  }).format(micros / 1_000_000)} Coin`;
export function creditChoice(): { funding: AiFunding; model: string } {
  try {
    const saved = readAgentStorage("filey.ai.funding");
    if (!saved) {
      // Existing connections predate the funding selector. Retain that choice;
      // only a new account without a saved connection defaults to Coin.
      const scope = getCacheScope();
      const config = JSON.parse(scope ? localStorage.getItem(`filey.ai.config:${encodeURIComponent(scope)}`) ?? "null" : "null");
      if ((config?.provider === "openai" || config?.provider === "anthropic") &&
        typeof config.baseUrl === "string" && config.baseUrl.trim() &&
        typeof config.model === "string" && config.model.trim())
        return { funding: "byok", model: "" };
      return { funding: "credits", model: FILEY_AI_MODEL };
    }
    const value = JSON.parse(saved);
    if (value?.funding === "credits") return { funding: "credits", model: FILEY_AI_MODEL };
    // Retired free funding needs an explicit choice before it can spend Coin.
    if (value?.funding === "free") return { funding: "free", model: "" };
    return { funding: "byok", model: "" };
  } catch {
    return { funding: "byok", model: "" };
  }
}
export function setCreditChoice(funding: AiFunding, _model?: string) {
  if (funding === "free") throw new Error("Choose Filey AI to use Coin, or use your own API key.");
  writeAgentStorage("filey.ai.funding", JSON.stringify({ funding, model: funding === "credits" ? FILEY_AI_MODEL : "" }));
  window.dispatchEvent(new Event(AI_CREDITS_EVENT));
}

export async function aiAccountSession() {
  if (!supabase) throw new Error("Connect your Filey account to use Coin.");
  const scope = agentStorageScope();
  const reviewedUser = scope?.includes(":user:")
    ? scope.slice(scope.lastIndexOf(":user:") + 6)
    : null;
  let response: Awaited<ReturnType<typeof supabase.auth.getSession>>;
  try { response = await supabase.auth.getSession(); }
  catch (error) {
    if (scope !== agentStorageScope())
      throw new Error("Your workspace changed. Refresh your Coin wallet.");
    if (recoverableCompletionTransport(error))
      throw new CompletionTransportError("We couldn’t connect. Check your internet connection and try again.");
    throw new Error("Please sign in to your Filey account again, then try this action.");
  }
  const { data, error } = response;
  if (scope !== agentStorageScope())
    throw new Error("Your workspace changed. Refresh your Coin wallet.");
  if (error && recoverableCompletionTransport(error))
    throw new CompletionTransportError("We couldn’t connect. Check your internet connection and try again.");
  if (error || !data.session)
    throw new Error(
      "Sign in to your cloud account to use Coin. Your device records stay on this device."
    );
  // A newly selected SDK session can arrive before the workspace cache catches
  // up. It must not pay for a task or recharge reviewed under the old account.
  if (reviewedUser && data.session.user.id !== reviewedUser)
    throw new Error("Your account changed. Refresh your Coin wallet.");
  return data.session;
}
const accountSession = aiAccountSession;
type CreditTransport = { signal?: AbortSignal | null; timeout?: number };
class CompletionTransportError extends Error {
  constructor(message: string) { super(message); this.name = "CompletionTransportError"; }
}
function recoverableCompletionTransport(error: unknown): boolean {
  const value = error as { name?: string; message?: string; status?: number; context?: { status?: number } } | null;
  const status = value?.context?.status ?? value?.status;
  if (status === 401 || status === 403) return false;
  return value?.name === "FunctionsFetchError" || value?.name === "FunctionsRelayError" ||
    value?.name === "AuthRetryableFetchError" ||
    [408, 425, 429, 500, 502, 503, 504].includes(status ?? 0) ||
    (status === undefined && /network|connection lost|failed to fetch|failed to send a request|timeout|timed out/i.test(value?.message ?? ""));
}
export async function callAiService<T>(
  name: string,
  body: Record<string, unknown>,
  expectedUser?: string,
  beforeDispatch?: () => void,
  transport?: CreditTransport
): Promise<T> {
  const scope = agentStorageScope();
  const assertCurrent = () => {
    if (scope !== agentStorageScope())
      throw new Error("Your workspace changed. Start a new task.");
    beforeDispatch?.();
  };
  assertCurrent();
  const session = await accountSession();
  assertCurrent();
  if (expectedUser && session.user.id !== expectedUser)
    throw new Error("Your account changed. Start a new task.");
  if (!session.access_token?.trim())
    throw new Error("Please sign in to your Filey account again, then try this action.");
  // No automatic retries for anything that might charge money or call a model.
  // Pin the verified account: the SDK otherwise obtains the active token later,
  // after an asynchronous gap that could select another signed-in account.
  const unavailable = name === "dodo"
    ? "Coin checkout is temporarily unavailable. Please try again shortly."
    : "Your AI wallet is temporarily unavailable. Please try again shortly.";
  const invoke = () => supabase!.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
    ...(transport?.signal ? { signal: transport.signal } : {}),
    ...(transport?.timeout ? { timeout: transport.timeout } : {}),
  });
  let response: Awaited<ReturnType<typeof invoke>>;
  try { response = await invoke(); }
  catch (error) {
    assertCurrent();
    const safe = await serviceError(error, unavailable);
    if (transport && recoverableCompletionTransport(error)) throw new CompletionTransportError(safe.message);
    throw safe;
  }
  const { data, error } = response;
  if (error) {
    assertCurrent();
    const safe = await serviceError(error, unavailable);
    if (transport && recoverableCompletionTransport(error)) throw new CompletionTransportError(safe.message);
    throw safe;
  }
  if (data?.error)
    throw await serviceError(new Error(data.error), unavailable);
  const current = await accountSession();
  assertCurrent();
  if (current.user.id !== session.user.id)
    throw new Error("Your account changed. Refresh your Coin wallet.");
  return data as T;
}
const call = callAiService;
let cached: { user: string; value: CreditStatus; expires: number } | undefined;
let statusRevision = 0;
export function invalidateCreditStatus() {
  statusRevision++;
  cached = undefined;
  window.dispatchEvent(new Event(AI_CREDITS_EVENT));
}
export async function getCreditStatus(force = false): Promise<CreditStatus> {
  const scope = agentStorageScope();
  const session = await accountSession();
  if (scope !== agentStorageScope())
    throw new Error("Your workspace changed. Refresh your Coin wallet.");
  if (!force && cached?.user === session.user.id && cached.expires > Date.now())
    return cached.value;
  const revision = ++statusRevision;
  const value = await call<CreditStatus>(
    "ai-credits",
    { action: "status" },
    session.user.id
  );
  if (revision === statusRevision)
    cached = { user: session.user.id, value, expires: Date.now() + 60000 };
  return value;
}
export async function creditHistory(before: number) {
  return (
    await call<{ history: CreditEntry[] }>("ai-credits", { action: "history", before })
  ).history;
}
const creditOrderId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function verifyCreditCheckout(orderId: string): Promise<boolean> {
  if (orderId.length !== 36 || !creditOrderId.test(orderId)) return false;
  const result = await call<{ confirmed: boolean }>("ai-credits", {
    action: "checkout_status",
    order_id: orderId,
  });
  return result?.confirmed === true;
}
export async function buyAiCredits(amount: string | number, promotionId?: string) {
  if (
    typeof amount === "number" &&
    (!Number.isSafeInteger(amount) || amount < 500 || amount > 10000)
  )
    throw new Error("Enter an AI credit amount from $5 to $100.");
  if (promotionId !== undefined &&
    (promotionId.length !== 36 || !creditOrderId.test(promotionId)))
    throw new Error("This test offer is unavailable. Refresh your Coin wallet.");
  const checkout = await call<{ url: string; order_id: string }>("dodo", {
    action: "checkout_ai_credits",
    ...(typeof amount === "number" ? { amount_cents: amount } : { pack_id: amount }),
    ...(promotionId !== undefined ? { promotion_id: promotionId } : {}),
  });
  if (!checkout || typeof checkout.order_id !== "string" || checkout.order_id.length !== 36 || !creditOrderId.test(checkout.order_id))
    throw new Error(BILLING_UNAVAILABLE);
  const mode = await openBilling(checkout.url);
  return { mode, order_id: checkout.order_id };
}

type ManagedCompletion = {
  state?: "pending" | "complete" | "failed" | "missing";
  completion?: unknown;
  account?: CreditAccount;
  charged_micros?: number;
  message?: string;
};

function completionConnectionReady(): boolean {
  return (typeof document === "undefined" || document.visibilityState !== "hidden") &&
    (typeof navigator === "undefined" || navigator.onLine !== false);
}

function completionWithAbort<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const stop = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", stop);
    signal.addEventListener("abort", stop, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) stop();
  });
}

/** Waiting for an existing model receipt is read-only. Hidden/offline time
 * consumes no active retry budget and wakes promptly when the app returns. */
async function recoverManagedCompletion(
  body: Record<string, unknown>, requireOwner: () => Promise<string>, assertCurrent: () => void, signal?: AbortSignal | null
): Promise<ManagedCompletion> {
  const recoveryEvents = ["online", "offline", "focus", AGENT_STORAGE_EVENT, "storage", "filey:workspace-changed", "filey:workspace-transition"];
  let activeElapsed = 0, activeSince: number | null = completionConnectionReady() ? Date.now() : null;
  const connectionChanged = () => {
    if (activeSince !== null) activeElapsed += Math.max(0, Date.now() - activeSince);
    activeSince = completionConnectionReady() ? Date.now() : null;
  };
  for (const event of ["online", "offline", "focus"]) window.addEventListener(event, connectionChanged);
  document.addEventListener("visibilitychange", connectionChanged);
  const remaining = () => 300_000 - activeElapsed - (activeSince === null ? 0 : Math.max(0, Date.now() - activeSince));
  const wait = (delay: number) => new Promise<void>((resolve, reject) => {
    let elapsed = delay === 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", wake);
      for (const event of recoveryEvents) window.removeEventListener(event, wake);
      document.removeEventListener("visibilitychange", wake);
    };
    const wake = (event?: Event) => {
      try { assertCurrent(); }
      catch (error) { cleanup(); reject(error); return; }
      if (completionConnectionReady() && (elapsed || event?.type === "online" || event?.type === "focus" || event?.type === "visibilitychange")) {
        cleanup(); resolve();
      }
    };
    signal?.addEventListener("abort", wake, { once: true });
    for (const event of recoveryEvents) window.addEventListener(event, wake);
    document.addEventListener("visibilitychange", wake);
    if (delay) timer = setTimeout(() => { elapsed = true; wake(); }, delay);
    wake();
  });
  let action: "completion" | "completion_status" = "completion", submissions = 0;
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      await wait(attempt ? 3000 : 0);
      assertCurrent();
      if (remaining() <= 0) break;
      let result: ManagedCompletion;
      let dispatchStarted = false;
      try {
        const userId = await completionWithAbort(requireOwner(), signal);
        assertCurrent();
        if (action === "completion") submissions++;
        dispatchStarted = true;
        result = await completionWithAbort(call<ManagedCompletion>("ai-credits",
          action === "completion" ? body : { action, request_id: body.request_id, org_id: body.org_id },
          userId, assertCurrent, { signal, timeout: Math.max(1, Math.min(15_000, remaining())) }), signal);
      } catch (error) {
        assertCurrent();
        if (!(error instanceof CompletionTransportError)) throw error;
        // A lost HTTP acknowledgement never authorizes a new model request.
        if (dispatchStarted) action = "completion_status";
        continue;
      }
      assertCurrent();
      if (result?.state === "complete" || (result?.state === undefined && result?.completion !== undefined)) {
        if (!result.completion || typeof result.completion !== "object" || Array.isArray(result.completion))
          throw new Error("Filey AI did not return a valid reply. Check your chat before trying again.");
        return result;
      }
      if (result?.state === "failed") {
        const message = typeof result.message === "string" ? result.message : "";
        if (["This reply has expired. Start a new task.", "Filey AI could not finish this request. No Coins were charged."].includes(message))
          throw new Error(message);
        throw await serviceError(new Error(message), "Filey AI could not complete this request. Check any earlier work before trying again.");
      }
      if (result?.state === "missing" && action === "completion_status") {
        if (submissions >= 3) break;
        // Only an owner-scoped missing receipt permits the exact original UUID
        // and payload to be submitted again. The server claims it atomically.
        action = "completion";
      } else if (result?.state === "pending") action = "completion_status";
      else throw new Error("Filey AI recovery is unavailable. Check your chat before trying again.");
    }
    throw new Error("Filey AI is still reconnecting. Your request was not repeated. Check your connection before continuing.");
  } finally {
    for (const event of ["online", "offline", "focus"]) window.removeEventListener(event, connectionChanged);
    document.removeEventListener("visibilitychange", connectionChanged);
  }
}

/** One closure per task; delegated rounds share the same wallet run identity.
 * Choice changes apply to the next task. Never fall back to credits from BYOK. */
export function createCreditFetch(funding: "credits" | "free" = "credits") {
  if (funding === "free") throw new Error("Choose Filey AI to use Coin, or use your own API key.");
  const runId = crypto.randomUUID(),
    scope = agentStorageScope();
  const recoverable = scope?.startsWith("cloud:") === true;
  const orgId = recoverable ? getCacheOrg() : null;
  let owner: Awaited<ReturnType<typeof accountSession>> | undefined;
  return async (_url: string, init: RequestInit): Promise<Response> => {
    const assertCurrent = () => {
      if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (scope !== agentStorageScope())
        throw new Error("Your workspace changed. Start a new task.");
    };
    assertCurrent();
    if (recoverable && !orgId) throw new Error("Your cloud workspace is unavailable. Reopen Filey AI.");
    const body = { action: "completion", funding, run_id: runId, request_id: crypto.randomUUID(),
      request: { ...JSON.parse(String(init.body)), model: FILEY_AI_MODEL },
      ...(recoverable ? { recoverable: true, org_id: orgId } : {}) };
    const requireOwner = async () => (owner ??= await accountSession()).user.id;
    const result = recoverable
      ? await recoverManagedCompletion(body, requireOwner, assertCurrent, init.signal)
      : await call<ManagedCompletion>("ai-credits", body, await requireOwner(), assertCurrent);
    // A stopped turn can have billable provider usage. Settle it, then stop
    // before any model output can execute another tool.
    statusRevision++;
    if (result.account && owner && cached?.user === owner.user.id)
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
