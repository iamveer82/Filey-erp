/** Managed chat uses Filey's one server-owned provider. BYOK is separate.
 * Old gateway/model configuration cannot select a route or become a fallback. */
export function creditGateway(free = false) {
  if (free) return null;
  const key = Deno.env.get("FILEY_AI_GLM_KEY")?.trim();
  if (!key) return null;
  return {
    kind: "zai" as const,
    // Z.ai's pay-as-you-go API (the account's API credit), not the Coding Plan endpoint.
    url: "https://api.z.ai/api/paas/v4/chat/completions",
    key,
  };
}
