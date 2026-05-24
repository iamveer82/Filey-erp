/* Bring-your-own-key AI client.
 *
 * The user supplies their own provider + model + API key. The key is stored
 * ONLY in this browser (localStorage) and never sent to Filey's servers —
 * every request goes straight from the browser to the chosen provider's API.
 *
 * Two transports cover essentially every model:
 *  - "openai"    → OpenAI Chat Completions shape. Works with OpenAI, OpenRouter,
 *                  Together, Groq, Mistral, local Ollama/LM Studio, etc. via a
 *                  configurable base URL ("any model via custom key").
 *  - "anthropic" → Claude Messages API (native).
 */

export type AiProvider = "openai" | "anthropic";

export interface AiConfig {
  provider: AiProvider;
  /** OpenAI-compatible base URL (ignored for the anthropic provider). */
  baseUrl: string;
  model: string;
  apiKey: string;
}

const STORE_KEY = "filey.ai.config";

const DEFAULTS: AiConfig = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
};

export function getAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AiConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setAiConfig(patch: Partial<AiConfig>): AiConfig {
  const next = { ...getAiConfig(), ...patch };
  localStorage.setItem(STORE_KEY, JSON.stringify(next));
  return next;
}

export function aiReady(cfg: AiConfig = getAiConfig()): boolean {
  return !!cfg.apiKey.trim() && !!cfg.model.trim();
}

export type AiRole = "system" | "user" | "assistant";
export interface AiImage {
  /** e.g. "image/png", "image/jpeg" */
  mediaType: string;
  /** base64 WITHOUT the data: prefix */
  dataBase64: string;
}
export interface AiMessage {
  role: AiRole;
  text: string;
  images?: AiImage[];
}

export class AiError extends Error {}

interface ChatOpts {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export async function aiChat(
  messages: AiMessage[],
  opts: ChatOpts = {}
): Promise<string> {
  const cfg = getAiConfig();
  if (!aiReady(cfg))
    throw new AiError(
      "No AI model connected. Add your key in Settings → AI Assistant."
    );
  return cfg.provider === "anthropic"
    ? anthropicChat(cfg, messages, opts)
    : openaiChat(cfg, messages, opts);
}

async function openaiChat(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: ChatOpts
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model: cfg.model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.4,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.images?.length
        ? [
            { type: "text", text: m.text },
            ...m.images.map((im) => ({
              type: "image_url",
              image_url: { url: `data:${im.mediaType};base64,${im.dataBase64}` },
            })),
          ]
        : m.text,
    })),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) throw new AiError(await errText(res));
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

async function anthropicChat(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: ChatOpts
): Promise<string> {
  const base = cfg.baseUrl.includes("anthropic")
    ? cfg.baseUrl.replace(/\/+$/, "")
    : "https://api.anthropic.com/v1";
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.text)
    .join("\n\n");
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: [
        { type: "text", text: m.text },
        ...(m.images ?? []).map((im) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: im.mediaType,
            data: im.dataBase64,
          },
        })),
      ],
    }));
  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      // lets the browser call the API directly (BYOK, no proxy)
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: system || undefined,
      messages: turns,
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new AiError(await errText(res));
  const data = await res.json();
  return (data?.content ?? [])
    .filter((b: { type?: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("")
    .trim();
}

async function errText(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error?.message || j?.message || `AI request failed (${res.status})`;
  } catch {
    return `AI request failed (${res.status})`;
  }
}

/* ── Document extraction (#21): an image of an invoice/receipt → fields ───── */

export interface ExtractedInvoice {
  seller_name?: string;
  customer_name?: string;
  customer_address?: string;
  customer_trn?: string;
  issue_date?: string;
  due_date?: string;
  currency?: string;
  notes?: string;
  items?: { description: string; qty: number; unit_price: number }[];
}

export async function extractInvoiceFromImage(
  image: AiImage,
  opts: ChatOpts = {}
): Promise<ExtractedInvoice> {
  const prompt = `You parse business documents. Read this invoice / receipt / quote and return STRICT JSON of this exact shape:
{"seller_name":"","customer_name":"","customer_address":"","customer_trn":"","issue_date":"YYYY-MM-DD","due_date":"YYYY-MM-DD","currency":"ISO code e.g. AED","notes":"","items":[{"description":"","qty":0,"unit_price":0}]}
Rules: use an empty string or empty array when a field is unknown; numbers must be plain numbers; dates must be YYYY-MM-DD. Return ONLY the JSON object — no prose, no markdown fences.`;
  const out = await aiChat([{ role: "user", text: prompt, images: [image] }], {
    maxTokens: 1500,
    temperature: 0,
    ...opts,
  });
  return parseJson<ExtractedInvoice>(out);
}

/** Tolerant JSON extraction — strips code fences / surrounding prose. */
export function parseJson<T>(s: string): T {
  let t = s.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t) as T;
}
