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
