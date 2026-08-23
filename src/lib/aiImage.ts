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

import { aiFetch, getAiConfig } from "./ai";

const STORE_KEY = "filey.ai.image";
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
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ImageConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setImageConfig(patch: Partial<ImageConfig>): ImageConfig {
  const next = { ...getImageConfig(), ...patch };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch (e) {
    console.error("Failed to save image config", e);
  }
  return next;
}

/** Where images will actually be generated from, once the fallbacks are
 *  resolved. Exported so Settings can show it rather than making the user
 *  guess which key is in play. */
export function resolveImageEndpoint(): {
  baseUrl: string;
  apiKey: string;
  model: string;
  usable: boolean;
  why?: string;
} {
  const img = getImageConfig();
  const chat = getAiConfig();
  const baseUrl = (img.baseUrl || chat.baseUrl || "").replace(/\/+$/, "");
  const apiKey = img.apiKey || chat.apiKey || "";
  const model = img.model || DEFAULTS.model;
  if (!apiKey)
    return { baseUrl, apiKey, model, usable: false, why: "No API key set." };
  if (/anthropic\.com/.test(baseUrl))
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
}

/** Generate one image. Returns raw bytes so the caller decides where it goes —
 *  a file on disk, My Files, or the media of a social post. */
export async function generateImage(
  prompt: string,
  opts: { size?: string; model?: string } = {}
): Promise<GeneratedImage> {
  const text = prompt.trim();
  if (!text) throw new ImageError("An image needs a prompt.");
  const ep = resolveImageEndpoint();
  if (!ep.usable) throw new ImageError(ep.why ?? "Image generation isn't configured.");
  const size = opts.size || getImageConfig().size || DEFAULTS.size;

  // Through the shared AI transport, not raw fetch: on the desktop that is the
  // native proxy, so providers without CORS headers work here exactly as they
  // do for chat — and transient failures get the same retry/backoff.
  const res = await aiFetch(
    `${ep.baseUrl}/images/generations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ep.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model || ep.model,
        prompt: text,
        n: 1,
        size,
      }),
      signal: timeoutSignal(GENERATE_TIMEOUT_MS),
    },
    { retries: 1 }
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
      img = await aiFetch(first.url, { signal: timeoutSignal(DOWNLOAD_TIMEOUT_MS) });
    } catch {
      throw new ImageError("Could not download the generated image.");
    }
    if (!img.ok) throw new ImageError("Could not download the generated image.");
    bytes = new Uint8Array(await img.arrayBuffer());
  } else {
    throw new ImageError("The provider returned neither image bytes nor a URL.");
  }

  const slug =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "image";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return { name: `${slug}-${stamp}.png`, bytes, prompt: text };
}
