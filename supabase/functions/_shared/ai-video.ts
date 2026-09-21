// A curated preset keeps the customer quote independent of provider pricing.
export const VIDEO_RATE_MICROS = 250_000;
export const HF_ORIGIN = "https://api.higgsfield.ai";
export const VIDEO_MODEL = "bytedance/seedance-2.0";
export const VIDEO_TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);
export const VIDEO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function videoInput(input: Record<string, unknown>) {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > 4000)
    throw new Error("Describe your video in 1–4,000 characters.");
  if (
    !Number.isInteger(input.duration) ||
    Number(input.duration) < 4 ||
    Number(input.duration) > 15
  )
    throw new Error("Choose a duration from 4 to 15 whole seconds.");
  const aspect = input.aspect_ratio ?? "9:16";
  if (!["9:16", "16:9", "1:1"].includes(String(aspect)))
    throw new Error("Choose portrait, landscape or square.");
  if (input.generate_audio !== undefined && typeof input.generate_audio !== "boolean")
    throw new Error("Invalid audio option.");
  return {
    prompt,
    duration: Number(input.duration),
    resolution: "720p",
    aspect_ratio: String(aspect),
    generate_audio: input.generate_audio !== false,
  };
}

export function videoQuote(duration: number) {
  if (!Number.isInteger(duration) || duration < 4 || duration > 15)
    throw new Error("Invalid video duration.");
  return duration * VIDEO_RATE_MICROS;
}

export function providerCost(body: { usd?: unknown }, quote: number) {
  if (typeof body.usd !== "string" && typeof body.usd !== "number")
    throw new Error("The provider did not return a price. Please try again later.");
  const usd = Number(body.usd);
  if (body.usd === "" || !Number.isFinite(usd) || usd < 0)
    throw new Error("Invalid provider estimate.");
  const micros = Math.round(usd * 1e6);
  if (micros > quote)
    throw new Error(
      "This model is temporarily unavailable at Filey’s price. No credits were used."
    );
  return micros;
}

/** Only our fixed API origin ever receives the merchant credentials. */
export function requestUrl(id: string, action: "status" | "cancel") {
  if (!VIDEO_UUID.test(id)) throw new Error("Invalid provider request ID.");
  return `${HF_ORIGIN}/requests/${id}/${action}`;
}

export function publicHttps(value: unknown): string {
  if (typeof value !== "string" || value.length > 8000)
    throw new Error("Invalid video file URL.");
  const u = new URL(value);
  // Provider output/upload URLs must be public DNS names, never loopback/IP URLs.
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !u.hostname.includes(".") ||
    /^[\d.]+$/.test(u.hostname) ||
    /[:\[\]]/.test(u.hostname) ||
    /\.(local|localhost|internal|test)$/.test(u.hostname)
  )
    throw new Error("Invalid video file URL.");
  return u.href;
}

export function referenceImage(
  value: unknown
): { bytes: Uint8Array; type: string } | undefined {
  if (value == null) return;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid reference image.");
  const { data, type } = value as Record<string, unknown>;
  if (
    typeof data !== "string" ||
    data.length > 2_800_000 ||
    !["image/jpeg", "image/png", "image/webp"].includes(String(type))
  )
    throw new Error("Use a JPG, PNG or WebP image under 2 MB.");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Invalid reference image.");
  }
  const matches =
    type === "image/jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : type === "image/png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
        : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!matches || bytes.length < 16 || bytes.length > 2_000_000)
    throw new Error("Use a valid JPG, PNG or WebP image under 2 MB.");
  return { bytes, type: String(type) };
}

export class HiggsfieldError extends Error {
  constructor(public status: number) {
    super(
      status === 401 || status === 403
        ? "Video generation is not connected. Filey’s provider credentials need attention."
        : status === 402
          ? "Video generation is temporarily unavailable. The provider balance needs attention."
          : status === 429
            ? "The video provider is busy. Try again later."
            : "The video provider could not process this request."
    );
  }
}

export async function higgsfield(path: string, init: RequestInit = {}) {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Invalid provider path.");
  const id = Deno.env.get("HF_API_KEY_ID"),
    secret = Deno.env.get("HF_API_KEY_SECRET");
  if (!id || !secret)
    throw new Error(
      "Video generation is not connected yet. Filey’s administrator needs to configure Higgsfield."
    );
  const res = await fetch(HF_ORIGIN + path, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(init.method === "POST" ? 25000 : 7000),
    headers: { "Content-Type": "application/json", Authorization: `Key ${id}:${secret}` },
  });
  if (!res.ok) throw new HiggsfieldError(res.status);
  return res;
}

export async function uploadReference(image: { bytes: Uint8Array; type: string }) {
  const ticket = await (
    await higgsfield("/files/generate-upload-url", {
      method: "POST",
      body: JSON.stringify({ content_type: image.type }),
    })
  ).json();
  const url = publicHttps(ticket.public_url),
    upload = publicHttps(ticket.upload_url);
  const headers = new Headers({ "Content-Type": image.type });
  // Signed object storage headers only; never forward an Authorization header.
  for (const [key, value] of Object.entries(ticket.upload_headers ?? {}))
    if (
      /^(content-type|x-amz-[\w-]+|x-goog-[\w-]+)$/i.test(key) &&
      typeof value === "string"
    )
      headers.set(key, value);
  const res = await fetch(upload, {
    method: "PUT",
    headers,
    body: new Blob([image.bytes as Uint8Array<ArrayBuffer>]),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok)
    throw new Error("Could not upload the reference image. No credits were used.");
  return url;
}

export async function boundedJson(
  req: Request,
  max = 2_900_000
): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("A request body is required.");
  let size = 0,
    raw = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new Error("Request too large.");
      }
      raw += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(raw + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } finally {
    reader.releaseLock();
  }
}
