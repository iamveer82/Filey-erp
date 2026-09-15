import type { AiConfig } from "./ai";

export function aiEndpoint(baseUrl: string): URL | null {
  try {
    const url = new URL(baseUrl.trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

/** Keyless inference is supported only on this device, never on a hosted provider. */
export function isLocalAiEndpoint(cfg: Pick<AiConfig, "provider" | "baseUrl">): boolean {
  const url = aiEndpoint(cfg.baseUrl);
  return cfg.provider === "openai" && !!url &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** A provider switch must not send the old provider's secret to a different host. */
export function mergeAiConfig(current: AiConfig, patch: Partial<AiConfig>): AiConfig {
  const next = { ...current, ...patch };
  if (patch.apiKey === undefined && patch.baseUrl !== undefined &&
    aiEndpoint(current.baseUrl)?.origin !== aiEndpoint(next.baseUrl)?.origin) next.apiKey = "";
  return next;
}

export function openAiHeaders(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(apiKey.trim() ? { authorization: `Bearer ${apiKey.trim()}` } : {}),
  };
}

/** Both plain chat and the agent must use the same model parameter rules. */
export type AiEffort = "auto" | "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT_LABELS: Record<AiEffort, string> = { auto: "Default", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum" };

export function aiEffortLevels(cfg: Pick<AiConfig, "provider" | "model">): AiEffort[] {
  const id = cfg.model.trim().split("/").pop() ?? "";
  if (cfg.provider === "anthropic") {
    if (/^claude-(?:opus-5|(?:fable|mythos)-5)/.test(id)) return ["auto", "low", "medium", "high", "xhigh", "max"];
    if (/^claude-opus-4-[6-8]/.test(id)) return ["auto", "low", "medium", "high", "max"];
    if (/^claude-(?:opus-4-5|sonnet-(?:4-6|5))/.test(id)) return ["auto", "low", "medium", "high"];
  } else {
    if (/^gpt-5-pro(?:-|$)/.test(id)) return ["auto", "high"];
    if (/^gpt-(?:5\.[2-9]|6)/.test(id)) return ["auto", ...(/-pro(?:-|$)/.test(id) ? [] : ["low" as const]), "medium", "high", "xhigh"];
    if (/^(?:o[134](?:-|$)|gpt-(?:5|oss)(?:[.-]|$))/.test(id) && !/^o1-(?:mini|preview)/.test(id)) return ["auto", "low", "medium", "high"];
  }
  return ["auto"];
}

function effortTokenLimit(maxTokens: number, effort: AiEffort) {
  return Math.max(maxTokens, { auto: 0, low: 8192, medium: 16384, high: 32768, xhigh: 65536, max: 65536 }[effort]);
}

export function anthropicGenerationOptions(model: string, maxTokens: number, effort: AiEffort = "auto") {
  const selected = aiEffortLevels({ provider: "anthropic", model }).includes(effort) ? effort : "auto";
  return { max_tokens: effortTokenLimit(maxTokens, selected), ...(selected !== "auto" ? { output_config: { effort: selected } } : {}) };
}

export function openAiGenerationOptions(model: string, maxTokens: number, temperature: number, effort: AiEffort = "auto") {
  const id = model.trim().split("/").pop() ?? "";
  const reasoning = /^(?:o[1-9](?:-|$)|gpt-(?:[5-9]|oss)(?:[.-]|$))/.test(id);
  const selected = aiEffortLevels({ provider: "openai", model }).includes(effort) ? effort : "auto";
  return reasoning ? { max_completion_tokens: effortTokenLimit(maxTokens, selected), ...(selected !== "auto" ? { reasoning_effort: selected } : {}) } : { max_tokens: maxTokens, temperature };
}

// Fixed destinations only: the localhost preview must not become an arbitrary
// URL proxy. Production desktop uses ai_proxy; hosted web uses provider CORS.
export const AI_DEV_ORIGINS = [
  "https://api.anthropic.com", "https://api.openai.com", "https://openrouter.ai",
  "https://api.groq.com", "https://api.moonshot.cn", "https://api.deepseek.com",
  "https://ollama.com", "https://api.x.ai", "https://generativelanguage.googleapis.com",
  "https://api.mistral.ai", "https://api.together.xyz", "https://opencode.ai",
  "https://api.cerebras.ai", "https://api.perplexity.ai", "https://api.deepinfra.com",
  "https://ai-gateway.vercel.sh", "https://open.bigmodel.cn",
];
