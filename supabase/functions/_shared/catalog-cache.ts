/** Cache provider catalogs only. Authenticate and check workspace access before
 * calling this; never cache account connections, records, tokens or writes. */
export interface CatalogResult { status: number; body: unknown }
const pending = new Map<string, Promise<CatalogResult>>();
const TTL = 300;
const MAX_BYTES = 512_000;

function valid(result: unknown): result is CatalogResult {
  if (!result || typeof result !== "object") return false;
  const value = result as CatalogResult;
  return value.status === 200 && !!value.body && typeof value.body === "object" &&
    Array.isArray((value.body as { items?: unknown }).items);
}

async function redis(command: (string | number)[]): Promise<unknown> {
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token || !url.startsWith("https://")) return null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.error ? null : data.result;
  } catch {
    // Redis is an optimization, not a requirement for using integrations.
    return null;
  }
}

export async function cachedCatalog(
  url: string,
  providerKey: string,
  load: () => Promise<CatalogResult>,
): Promise<CatalogResult> {
  // Catalogs can differ between provider accounts. Only a digest, never the
  // provider key, leaves this worker. Rotation gets a fresh cache namespace.
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([providerKey, url])));
  const key = `filey:catalog:v1:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("")}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const hit = await redis(["GET", key]);
    if (typeof hit === "string" && hit.length <= MAX_BYTES) {
      try {
        const result: unknown = JSON.parse(hit);
        if (valid(result)) return result;
      } catch { /* malformed entry: load from the provider */ }
    }
    const result = await load();
    if (valid(result)) {
      const encoded = JSON.stringify(result);
      if (new TextEncoder().encode(encoded).length <= MAX_BYTES)
        await redis(["SET", key, encoded, "EX", TTL]);
    }
    return result;
  })();
  pending.set(key, request);
  try { return await request; }
  finally { pending.delete(key); }
}
