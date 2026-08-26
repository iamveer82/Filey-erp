// Voice for Filey AI — speech-to-text and text-to-speech through the SAME
// BYOK providers the chat already uses. No new keys, no new settings screen:
// an OpenAI or Groq key unlocks both; everyone else gets the free browser
// engines where they exist.
//
//   STT: OpenAI  → api.openai.com/v1/audio/transcriptions (gpt-4o-transcribe)
//        Groq    → api.groq.com/openai/v1   (whisper-large-v3-turbo, very fast)
//   TTS: OpenAI  → /v1/audio/speech (tts-1) — Groq has no TTS yet.
//   Browser fallback: Web Speech API (Chromium) for mic input, speechSynthesis
//   for read-aloud — free, no keys, desktop-only.
import { getAiConfig } from "./ai";

/** Which cloud STT engine the configured provider unlocks, if any. Groq runs
 *  through the openai-compatible provider with a Groq base URL. */
export function sttEngine(): "openai" | "groq" | null {
  const { provider, baseUrl } = getAiConfig();
  if (provider !== "openai") return null;
  return /groq\.com/i.test(baseUrl || "") ? "groq" : "openai";
}

export function sttAvailable(): boolean {
  return sttEngine() !== null;
}

const STT_MODELS: Record<"openai" | "groq", string> = {
  openai: "gpt-4o-transcribe",
  groq: "whisper-large-v3-turbo",
};

/** Transcribe audio (mp3/wav/ogg/opus/m4a/webm — whatever the source gives)
 *  through the configured provider's OpenAI-compatible endpoint. */
export async function transcribeAudio(
  bytes: Uint8Array,
  opts: { mimetype?: string; filename?: string } = {}
): Promise<string> {
  const engine = sttEngine();
  if (!engine) throw new Error("no-speech-provider");
  const { baseUrl, apiKey } = getAiConfig();
  const base = baseUrl || "https://api.openai.com/v1";
  const form = new FormData();
  // A copy: the caller's view may be a slice of a larger buffer, which
  // Blob mis-reads (same guard as deliverFile).
  const copy = bytes.slice();
  const blob = new Blob([copy as BlobPart], {
    type: opts.mimetype || "audio/ogg",
  });
  form.append("file", blob, opts.filename || "audio.ogg");
  form.append("model", STT_MODELS[engine]);
  const res = await fetch(`${base.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`transcription failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/** TTS is OpenAI-only for now (Groq ships no speech endpoint). */
export function ttsAvailable(): boolean {
  return getAiConfig().provider === "openai";
}

/** Render text to mp3 bytes for a WhatsApp voice note. */
export async function textToSpeech(
  text: string,
  opts: { voice?: string } = {}
): Promise<Uint8Array> {
  const { baseUrl, apiKey } = getAiConfig();
  if (getAiConfig().provider !== "openai")
    throw new Error("no-tts-provider");
  const res = await fetch(
    `${(baseUrl || "https://api.openai.com/v1").replace(/\/$/, "")}/audio/speech`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: opts.voice || "alloy",
        input: text.slice(0, 4000),
        response_format: "mp3",
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`speech failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/* ── Browser engines (free, desktop WebView2/Chromium) ──────────────────── */

/** Browser speech recognition — Chromium only. Returns null where
 *  unsupported so callers can hide the mic instead of failing. */
export function speechRecognitionSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  );
}

export interface DictationSession {
  stop(): void;
}

/** Start dictating into `onText` (final chunks) and `onInterim` (live draft).
 *  Continuous until stop() — the mic is push-to-toggle, not push-to-talk. */
export function startDictation(handlers: {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onEnd?: () => void;
  onError?: (e: string) => void;
}): DictationSession | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec: any = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  rec.onresult = (event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) handlers.onFinal(r[0].transcript.trim());
      else interim += r[0].transcript;
    }
    if (interim) handlers.onInterim(interim);
  };
  rec.onerror = (e: { error?: string }) => handlers.onError?.(e.error ?? "speech error");
  rec.onend = () => handlers.onEnd?.();
  rec.start();
  return {
    stop() {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

/** Read a reply aloud with the browser voice. Returns false when the engine
 *  is missing — callers stay silent rather than pretending. */
export function speakAloud(text: string): boolean {
  if (typeof speechSynthesis === "undefined") return false;
  // Strip WhatsApp/agent markup so it isn't read out character by character.
  const clean = text.replace(/[*_`#·—]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean.slice(0, 1200));
  u.rate = 1.02;
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
