/** Keep the hosted authorization boundary independent of provider token data. */
export function composioIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 && !/[^a-zA-Z0-9_-]/.test(value);
}

export function composioAuthConfig(body: unknown, toolkit: string): string | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { items?: unknown }).items))
    throw new Error("Invalid integration authorization configuration.");
  const items = (body as { items: unknown[] }).items;
  if (items.length === 0) return null;
  const config = items[0] as { id?: unknown; toolkit?: { slug?: unknown }; status?: unknown } | null;
  if (!config || !composioIdentifier(config.id) || config.toolkit?.slug !== toolkit ||
    (config.status !== undefined && config.status !== "ENABLED"))
    throw new Error("Invalid integration authorization configuration.");
  return config.id;
}

export function createdComposioAuthConfig(body: unknown, toolkit: string): string {
  const config = body as { auth_config?: { id?: unknown }; toolkit?: { slug?: unknown } } | null;
  if (!config || config.toolkit?.slug !== toolkit || !composioIdentifier(config.auth_config?.id))
    throw new Error("Invalid integration authorization configuration.");
  return config.auth_config.id;
}

export function composioConnectLink(body: unknown): { redirect_url: string; connected_account_id: string } {
  const link = body as { redirect_url?: unknown; connected_account_id?: unknown } | null;
  // Control bytes and whitespace must not be normalized into an authorization URL.
  // eslint-disable-next-line no-control-regex
  const unsafeWhitespace = typeof link?.redirect_url === "string" && /[\u0000-\u0020\u007f]/.test(link.redirect_url);
  if (!link || !composioIdentifier(link.connected_account_id) || typeof link.redirect_url !== "string" ||
    link.redirect_url.length > 8192 || unsafeWhitespace)
    throw new Error("Invalid integration sign-in link.");
  const url = new URL(link.redirect_url);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid integration sign-in link.");
  // Link tokens, OAuth state and arbitrary extra provider fields stay server-side.
  return { redirect_url: url.href, connected_account_id: link.connected_account_id };
}
