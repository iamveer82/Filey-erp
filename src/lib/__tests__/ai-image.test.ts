import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getImageConfig,
  setImageConfig,
  resolveImageEndpoint,
  imageReady,
  generateImage,
} from "../aiImage";
import { setAiConfig } from "../ai";

// Image generation spends the user's money and writes a file, so the parts
// worth pinning are: which credential it decides to use, and that it never
// hands back a "saved" file it didn't actually receive.
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("which endpoint it will use", () => {
  it("borrows the chat provider's key when no image key is set", () => {
    setAiConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-chat",
      model: "gpt-5",
    });
    const ep = resolveImageEndpoint();
    expect(ep.usable).toBe(true);
    expect(ep.apiKey).toBe("sk-chat");
    expect(ep.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("prefers a dedicated image key when one is set", () => {
    setAiConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-chat",
      model: "gpt-5",
    });
    setImageConfig({ apiKey: "sk-image", baseUrl: "https://api.x.ai/v1" });
    const ep = resolveImageEndpoint();
    expect(ep.apiKey).toBe("sk-image");
    expect(ep.baseUrl).toBe("https://api.x.ai/v1");
  });

  it("refuses Anthropic with a reason instead of failing at the call", () => {
    setAiConfig({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant",
      model: "claude-opus-5",
    });
    const ep = resolveImageEndpoint();
    expect(ep.usable).toBe(false);
    expect(ep.why).toMatch(/no image endpoint/i);
    expect(imageReady()).toBe(false);
  });

  it("is not ready with no key at all", () => {
    expect(imageReady()).toBe(false);
  });
});

describe("generating", () => {
  const okConfig = () =>
    setAiConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-chat",
      model: "gpt-5",
    });

  it("decodes base64 bytes and names the file after the prompt", async () => {
    okConfig();
    // "hi" as base64 — enough to prove the decode path.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ b64_json: "aGk=" }] }),
      })) as unknown as typeof fetch
    );
    const img = await generateImage("A red delivery van in Dubai");
    expect(Array.from(img.bytes)).toEqual([104, 105]);
    expect(img.name).toMatch(/^a-red-delivery-van-in-dubai-\d+\.png$/);
  });

  it("downloads a URL response instead of storing a link that will expire", async () => {
    okConfig();
    const fetchMock = vi
      .fn()
      // 1st call: the generation request
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: "https://cdn.example/img.png" }] }),
      })
      // 2nd call: fetching the image itself
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const img = await generateImage("logo");
    expect(Array.from(img.bytes)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces the provider's own error message", async () => {
    okConfig();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Your prompt was rejected" } }),
      })) as unknown as typeof fetch
    );
    await expect(generateImage("x")).rejects.toThrow(/Your prompt was rejected/);
  });

  it("refuses an empty prompt before spending anything", async () => {
    okConfig();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await expect(generateImage("   ")).rejects.toThrow(/needs a prompt/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the size setting", () => {
    setImageConfig({ size: "1536x1024" });
    expect(getImageConfig().size).toBe("1536x1024");
  });
});
