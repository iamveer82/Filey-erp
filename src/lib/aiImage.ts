// Image generation for the agent.
//
// Uses the OpenAI-compatible /images/generations shape, which OpenAI, xAI,
// Together, Fireworks and most local servers all speak. Anthropic has no image
// endpoint, so a user on the Anthropic provider is told to point the image
// model at something that does rather than being handed a silent failure.
//
// The model and endpoint are configurable and stored device-locally next to the
// chat model key — an image key is a spending credential like any other and
// does not belong in synced settings.

import { aiFetch, getAiConfig, aiCredentialName } from "./ai";
import { aiEndpoint, isLocalAiEndpoint, openAiHeaders } from "./aiEndpoint";
import { getCacheScope } from "./api";
import { hasCredential, peekCredential, readCredential, saveCredential } from "./credentialStore";

const STORE_KEY = "filey.ai.image";
function configKey(expected?: string): string | null {
  const scope = getCacheScope();
  if (expected && scope !== expected) throw new Error("Your workspace changed. Reopen image settings.");
  return scope ? `${STORE_KEY}:${encodeURIComponent(scope)}` : null;
}
export const imageCredential = (cfg: Pick<ImageConfig,"baseUrl">) => `image:${aiEndpoint(cfg.baseUrl || getAiConfig().baseUrl)?.origin ?? "invalid"}`;
/** Image generation can legitimately take a while; the download of a
 *  provider-hosted result should not. */
const GENERATE_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const timeoutSignal = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;

export interface ImageConfig {
  /** Blank = borrow the chat provider's baseUrl and key. */
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
}

const DEFAULTS: ImageConfig = {
  baseUrl: "",
  apiKey: "",
  model: "gpt-image-1",
  size: "1024x1024",
};

export function getImageConfig(): ImageConfig {
  try {
    const key = configKey();
    const raw = key ? localStorage.getItem(key) : null;
    if (!raw) return { ...DEFAULTS };
    const cfg = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ImageConfig>) };
    return { ...cfg, apiKey: peekCredential(imageCredential(cfg)) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setImageConfig(patch: Partial<ImageConfig>, expectedScope?: string): ImageConfig {
  const key = configKey(expectedScope);
  if (!key) throw new Error("Sign in before saving image settings.");
  const next = { ...getImageConfig(), ...patch };
  if (patch.apiKey !== undefined) void saveCredential(imageCredential(next), patch.apiKey.trim() || null);
  const { apiKey: _secret, ...settings } = next;
  localStorage.setItem(key, JSON.stringify(settings));
  next.apiKey = peekCredential(imageCredential(next));
  return next;
}

/** Where images will actually be generated from, once the fallbacks are
 *  resolved. Exported so Settings can show it rather than making the user
 *  guess which key is in play. */
export function resolveImageEndpoint(img: ImageConfig = getImageConfig()): {
  baseUrl: string;
  apiKey: string;
  model: string;
  usable: boolean;
  why?: string;
} {
  const chat = getAiConfig();
  const baseUrl = (img.baseUrl || chat.baseUrl || "").replace(/\/+$/, "");
  const sameOrigin = aiEndpoint(baseUrl)?.origin === aiEndpoint(chat.baseUrl)?.origin;
  const apiKey = img.apiKey || (sameOrigin ? chat.apiKey : "") || "";
  const model = img.model || DEFAULTS.model;
  const endpoint = aiEndpoint(baseUrl);
  if (!endpoint || (endpoint.protocol !== "https:" && !isLocalAiEndpoint({ provider: "openai", baseUrl })))
    return { baseUrl, apiKey, model, usable: false, why: "Use an HTTPS image API URL, or a local server on this device." };
  if (!apiKey && !hasCredential(imageCredential(img)) && !(sameOrigin && hasCredential(aiCredentialName(chat))) &&
      !isLocalAiEndpoint({ provider: "openai", baseUrl }))
    return { baseUrl, apiKey, model, usable: false, why: "No API key set." };
  if (aiEndpoint(baseUrl)?.hostname === "api.anthropic.com")
    return {
      baseUrl,
      apiKey,
      model,
      usable: false,
      why: "Anthropic has no image endpoint — set an image provider in Settings → AI (OpenAI, xAI, Together, or a local server).",
    };
  return { baseUrl, apiKey, model, usable: true };
}

export const imageReady = (): boolean => resolveImageEndpoint().usable;

export class ImageError extends Error {}

const B64 = /^[A-Za-z0-9+/=\s]+$/;

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface GeneratedImage {
  name: string;
  bytes: Uint8Array;
  /** What the model was actually asked for, after any rewriting. */
  prompt: string;
  mime: string;
}

/** Generate one image. Returns raw bytes so the caller decides where it goes —
 *  a file on disk, My Files, or the media of a social post. */
export async function generateImage(
  prompt: string,
  opts: { size?: string; model?: string; config?: Omit<ImageConfig, "apiKey"> } = {}
): Promise<GeneratedImage> {
  const text = prompt.trim();
  if (!text) throw new ImageError("An image needs a prompt.");
  const img = opts.config ? { ...opts.config, apiKey: "" } : getImageConfig();
  const ep = resolveImageEndpoint(img);
  if (!ep.usable) throw new ImageError(ep.why ?? "Image generation isn't configured.");
  const scope = getCacheScope();
  if (!scope) throw new ImageError("Sign in before generating images.");
  const chat = getAiConfig();
  ep.apiKey = await readCredential(imageCredential(img), scope) ??
    (aiEndpoint(ep.baseUrl)?.origin === aiEndpoint(chat.baseUrl)?.origin ? await readCredential(aiCredentialName(chat), scope) : null) ?? "";
  if (!ep.apiKey && !isLocalAiEndpoint({ provider: "openai", baseUrl: ep.baseUrl }))
    throw new ImageError("The image provider needs its own API key.");
  const size = opts.size || img.size || DEFAULTS.size;

  // Through the shared AI transport, not raw fetch: on the desktop that is the
  // native proxy, so providers without CORS headers work here exactly as they
  // do for chat — and transient failures get the same retry/backoff.
  const res = await aiFetch(
    `${ep.baseUrl}/images/generations`,
    {
      method: "POST",
      headers: openAiHeaders(ep.apiKey),
      body: JSON.stringify({
        model: opts.model || ep.model,
        prompt: text,
        n: 1,
        size,
      }),
      signal: timeoutSignal(GENERATE_TIMEOUT_MS),
    },
    { retries: 0 }
  );
  const body = (await res.json().catch(() => ({}))) as {
    data?: { b64_json?: string; url?: string }[];
    error?: { message?: string };
  };
  if (!res.ok)
    throw new ImageError(
      body?.error?.message ?? `Image generation failed (${res.status}).`
    );

  const first = body.data?.[0];
  if (!first) throw new ImageError("The provider returned no image.");

  let bytes: Uint8Array;
  if (first.b64_json && B64.test(first.b64_json)) {
    bytes = decodeBase64(first.b64_json);
  } else if (first.url) {
    // Some providers hand back a short-lived URL instead of bytes. Fetch it
    // now — the link expires, and a saved file that 404s later is worse than
    // no file at all. Same transport as the request (desktop CORS), with a
    // timeout so a stalled CDN can't hang the turn.
    let img: Response;
    try {
      // The JSON-only native AI proxy cannot transport binary image bytes.
      const { downloadMedia } = await import("./mediaDownload");
      img = await downloadMedia(first.url, timeoutSignal(DOWNLOAD_TIMEOUT_MS));
    } catch {
      throw new ImageError("Could not download the generated image.");
    }
    if (!img.ok) throw new ImageError("Could not download the generated image.");
    bytes = new Uint8Array(await img.arrayBuffer());
  } else {
    throw new ImageError("The provider returned neither image bytes nor a URL.");
  }

  if (scope !== getCacheScope()) throw new ImageError("Your workspace changed. The image was not added to this workspace.");
  if (!bytes.length || bytes.length > 20_000_000) throw new ImageError("The image is empty or exceeds the 20 MB limit.");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45;
  const extension = jpeg ? "jpg" : webp ? "webp" : "png";
  const slug =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "image";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return { name: `${slug}-${stamp}.${extension}`, bytes, prompt: text, mime: `image/${jpeg ? "jpeg" : extension}` };
}
