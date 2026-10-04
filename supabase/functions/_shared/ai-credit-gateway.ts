/** Managed chat uses Filey's one server-owned provider. BYOK is separate.
 * Old gateway/model configuration cannot select a route or become a fallback. */
export function creditGateway(free = false) {
  if (free) return null;
  const key = Deno.env.get("FILEY_AI_DEEPSEEK_KEY")?.trim();
  if (!key) return null;
  return {
    kind: "deepseek" as const,
    url: "https://api.deepseek.com/chat/completions",
    key,
  };
}
