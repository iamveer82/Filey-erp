// Security primitives for the channel webhook, split out of index.ts so
// they're unit-testable without booting the server (same reasoning as
// parse.ts). Nothing in here reads the environment — callers hand in the
// secrets they resolved — and nothing touches the network except the
// PostgREST insert behind claimSeenMessage.
//
// TIMING: every secret comparison goes through timingSafeEqualStr. The raw
// loop leaks length on mismatch (unavoidable with string compares), so we
// hash both sides first: equal-length digests, no early exit, nothing leaked.

/** Length-safe constant-time compare for two strings. Unlike a bare
 *  char-by-char loop it never throws or short-circuits on length mismatch,
 *  so call sites don't need their own guard. Hashing normalizes length,
 *  which is what lets one wrapper serve tokens, digests and codes alike. */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

/** Lowercase hex of HMAC-SHA256(key, message) — WebCrypto, no deps. */
export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** N random decimal digits from the CSPRNG — approval/pair/pin codes.
 *  Rejection sampling keeps the distribution uniform: a raw modulo over the
 *  uint32 range would bias the leading digit toward small values, which for
 *  a 4-digit code measurably shrinks the search space. */
export function randomCode(len: number): string {
  const span = Math.pow(10, len);
  // Largest multiple of span below 2^32 → every accepted draw is equally likely.
  const max = Math.floor(0x100000000 / span) * span;
  const buf = new Uint32Array(1);
  let v = 0;
  do {
    crypto.getRandomValues(buf);
    v = buf[0]!;
  } while (v >= max);
  return String(v % span).padStart(len, "0");
}

export function fourDigitCode(): string {
  return randomCode(4);
}

/** Slack Events API auth: X-Slack-Signature must be "v0=" + HMAC-SHA256 hex
 *  of `v0:<X-Slack-Request-Timestamp>:<rawBody>` keyed with the signing
 *  secret, and the timestamp must be within 5 minutes (replay guard).
 *  Callers resolve the secret (agent_channels row, else env) and pass it in;
 *  an unset secret REJECTS — fail-closed, never skip. */
export async function verifySlackSignature(
  req: Request,
  rawBody: string,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return false;
  const ts = req.headers.get("X-Slack-Request-Timestamp") ?? "";
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 5 * 60) {
    return false; // missing or older than 5 minutes → reject (replay guard)
  }
  const expected = "v0=" + (await hmacSha256Hex(secret, `v0:${ts}:${rawBody}`));
  return timingSafeEqualStr(expected, req.headers.get("X-Slack-Signature") ?? "");
}

/** WhatsApp Cloud API auth: the X-Hub-Signature-256 header must be
 *  "sha256=" + HMAC-SHA256 hex of the raw body keyed with the app secret.
 *  An unset secret REJECTS — fail-closed, never skip. */
export async function verifyWhatsAppSignature(
  req: Request,
  rawBody: string,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return false;
  const expected = "sha256=" + (await hmacSha256Hex(secret, rawBody));
  return timingSafeEqualStr(expected, req.headers.get("X-Hub-Signature-256") ?? "");
}

/** Inbound provider-message dedup. Inserts the marker into
 *  channel_seen_messages (migration 2026-08-22-agent-hardening.sql); returns
 *  true only when THIS request's row won — a redelivered webhook loses the
 *  unique(channel, external_id) race and gets swallowed with a plain 200.
 *  Fail-open on storage errors (e.g. migration not applied yet): a duplicated
 *  reply is annoying, silently dropping messages is worse. */
export async function claimSeenMessage(
  client: any,
  channel: string,
  externalId: string,
): Promise<boolean> {
  try {
    // supabase-js has no .insert().onConflict().ignore() — onConflict is an
    // upsert option, and insert() returns a PostgrestFilterBuilder without it.
    // Calling it threw, the catch below swallowed the throw and returned true,
    // so the dedup silently never fired. With ignoreDuplicates the statement is
    // ON CONFLICT DO NOTHING and select() returns only rows this call inserted.
    const { data, error } = await client
      .from("channel_seen_messages")
      .upsert(
        { channel, external_id: externalId },
        { onConflict: "channel,external_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      console.error("channel_seen_messages", error.message ?? error);
      return true; // fail open — process rather than lose the message
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.error("channel_seen_messages", e);
    return true;
  }
}
