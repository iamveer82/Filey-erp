import { publicHttps } from "./ai-video.ts";

/** Merchant configuration only. Never take a gateway URL/key from a client. */
export function creditGateway(free = false) {
  const openrouterKey = Deno.env.get("FILEY_AI_OPENROUTER_KEY")?.trim();
  if (!openrouterKey) return null;
  const gateway = free
    ? "openrouter"
    : (Deno.env.get("FILEY_AI_GATEWAY") ?? "openrouter");
  if (gateway === "openrouter")
    return {
      kind: "openrouter" as const,
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: openrouterKey,
    };
  if (gateway !== "omniroute") return null;
  const key = Deno.env.get("FILEY_AI_OMNIROUTE_KEY")?.trim();
  try {
    const base = new URL(publicHttps(Deno.env.get("FILEY_AI_OMNIROUTE_URL")));
    if (!key || base.search || base.hash || !/^\/v1\/?$/.test(base.pathname)) return null;
    return { kind: "omniroute" as const, url: `${base.origin}/v1/chat/completions`, key };
  } catch {
    return null; // Partial/invalid gateway setup must never switch billing routes.
  }
}

const RECEIPT_ERROR =
  "The provider did not return verifiable usage. No Filey credits were charged.";

/** OmniRoute's cost header is an estimate and its sanitizer strips usage.cost.
 * Verify the actual OpenRouter receipt, bound to this one Filey request. This
 * also rejects cached/replayed responses and unexpected model substitutions. */
export async function gatewayReceipt(id: unknown, model: string, requestId: string) {
  if (typeof id !== "string" || !/^gen-[A-Za-z0-9_-]{1,180}$/.test(id))
    throw new Error(RECEIPT_ERROR);
  const key = Deno.env.get("FILEY_AI_OPENROUTER_KEY")?.trim();
  if (!key) throw new Error(RECEIPT_ERROR);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      }
    );
    if (!response.ok) {
      await response.body?.cancel();
      // Receipts can arrive shortly after a completion. Retry only the read,
      // never inference; an unavailable receipt cannot debit the wallet.
      if (response.status === 404 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      throw new Error(RECEIPT_ERROR);
    }
    const { data } = await response.json();
    if (
      !data ||
      data.id !== id ||
      data.model !== model ||
      data.external_user !== requestId ||
      data.is_byok !== false ||
      typeof data.total_cost !== "number" ||
      !Number.isFinite(data.total_cost) ||
      data.total_cost < 0 ||
      data.total_cost > 1000
    )
      throw new Error(RECEIPT_ERROR);
    return {
      cost: data.total_cost as number,
      prompt_tokens: data.native_tokens_prompt,
      completion_tokens: data.native_tokens_completion,
    };
  }
  throw new Error(RECEIPT_ERROR);
}
