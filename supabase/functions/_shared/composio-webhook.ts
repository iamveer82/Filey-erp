// Composio webhook: signature check and event parsing, kept pure so it can be tested.
//
// Composio signs like the Standard Webhooks spec: HMAC-SHA256 over
// "<webhook-id>.<webhook-timestamp>.<raw body>", base64, sent as
// "v1,<signature>" (several may be listed, space separated, during a secret
// rotation). Composio's docs use the secret's own UTF-8 bytes as the key; a
// "whsec_"-prefixed secret is the Standard Webhooks form, where the key is the
// base64 after the prefix. Both are accepted.

/** Events older or newer than this are refused, so a captured request cannot be replayed later. */
export const TOLERANCE_SECONDS = 300;

function keyBytes(secret: string): Uint8Array<ArrayBuffer> {
  if (secret.startsWith("whsec_")) {
    try {
      return Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0));
    } catch { /* not base64 after all: fall back to the raw text */ }
  }
  return new TextEncoder().encode(secret) as Uint8Array<ArrayBuffer>;
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signComposio(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", keyBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  return btoa(String.fromCharCode(...mac));
}

/** True only for a fresh request carrying a valid signature from this secret. */
export async function verifyComposio(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature || id.length > 200 || !/^\d{1,16}$/.test(timestamp)) return false;
  // The unit is not documented; a 13-digit value is milliseconds.
  const sent = timestamp.length >= 13 ? Math.floor(Number(timestamp) / 1000) : Number(timestamp);
  if (Math.abs(nowSeconds - sent) > TOLERANCE_SECONDS) return false;
  const expected = await signComposio(secret, id, timestamp, body);
  return signature.split(" ").some((part) => {
    const value = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    return sameText(value, expected);
  });
}

export interface TriggerEvent {
  kind: "trigger";
  key: string;
  triggerId: string;
  triggerSlug: string;
  connectedAccountId: string;
  userId: string;
  data: unknown;
}

export interface ExpiredConnection {
  kind: "connection_expired";
  key: string;
  connectedAccountId: string;
  toolkit: string;
}

const text = (value: unknown, max = 200): string =>
  typeof value === "string" && value.length <= max ? value : "";

/** The parts Filey uses from a V3 envelope, or null for anything else. */
export function parseComposioEvent(body: unknown, fallbackKey: string): TriggerEvent | ExpiredConnection | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const event = body as { id?: unknown; type?: unknown; metadata?: Record<string, unknown>; data?: unknown };
  const key = text(event.id) || fallbackKey;
  if (!key) return null;
  if (event.type === "composio.trigger.message") {
    const meta = event.metadata ?? {};
    const triggerId = text(meta.trigger_id);
    const triggerSlug = text(meta.trigger_slug);
    if (!triggerId || !triggerSlug) return null;
    return {
      kind: "trigger", key, triggerId, triggerSlug,
      connectedAccountId: text(meta.connected_account_id), userId: text(meta.user_id), data: event.data ?? {},
    };
  }
  if (event.type === "composio.connected_account.expired") {
    const data = (event.data ?? {}) as { id?: unknown; toolkit?: { slug?: unknown } };
    const connectedAccountId = text(data.id);
    if (!connectedAccountId) return null;
    return { kind: "connection_expired", key, connectedAccountId, toolkit: text(data.toolkit?.slug, 80) };
  }
  return null;
}

/** Event data is stored for the owner to read, not kept as an archive: a huge
 *  payload (a whole email with attachments) is cut to a size a list can show. */
export const MAX_EVENT_BYTES = 32_000;
export function storableData(data: unknown): unknown {
  let serialized: string;
  try { serialized = JSON.stringify(data ?? {}); } catch { return { note: "The app sent data Filey could not read." }; }
  if (serialized.length <= MAX_EVENT_BYTES) return data ?? {};
  return { note: "The app sent more than Filey keeps per event; this is the start of it.", preview: serialized.slice(0, MAX_EVENT_BYTES - 200) };
}
