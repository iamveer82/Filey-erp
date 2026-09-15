import { afterEach, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({
  provider: "openai",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "test-key",
}));
vi.mock("../ai", () => ({ getAiConfig: () => config, getAiRequestConfig: async () => config }));
import { sttAvailable, ttsAvailable, transcribeAudio, textToSpeech } from "../voice";
afterEach(() => vi.unstubAllGlobals());

it("supports Groq transcription without offering an unsupported speech endpoint", async () => {
  config.baseUrl = "https://api.groq.com/openai/v1";
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ text: "Hello" }) }));
  vi.stubGlobal("fetch", fetch);
  expect(sttAvailable()).toBe(true);
  expect(ttsAvailable()).toBe(false);
  await expect(textToSpeech("Hello")).rejects.toThrow("no-tts-provider");
  expect(fetch).not.toHaveBeenCalled();
  expect(await transcribeAudio(new Uint8Array([1]))).toBe("Hello");
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/audio/transcriptions"),
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
});

it("bounds supported speech generation with a request timeout", async () => {
  config.baseUrl = "https://api.openai.com/v1";
  const fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1]).buffer,
  }));
  vi.stubGlobal("fetch", fetch);
  expect(ttsAvailable()).toBe(true);
  await textToSpeech("Hello");
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/audio/speech"),
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
});
