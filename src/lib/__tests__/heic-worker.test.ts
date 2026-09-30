// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";

class DecoderWorker {
  static instances: DecoderWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { DecoderWorker.instances.push(this); }
}

beforeAll(() => {
  vi.stubGlobal("DOMMatrix", class {});
  vi.stubGlobal("Path2D", class {});
});

afterEach(() => {
  DecoderWorker.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("terminates the owned HEIC decoder when the user cancels", async () => {
  vi.stubGlobal("Worker", DecoderWorker);
  const { heicToPdf } = await import("../pdfTools");
  const controller = new AbortController();
  const conversion = heicToPdf(new File(["fixture"], "photo.heic"), { signal: controller.signal });
  controller.abort();
  await expect(conversion).rejects.toMatchObject({ name: "AbortError" });
  expect(DecoderWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it("handles cancellation from the progress callback before decoding starts", async () => {
  vi.stubGlobal("Worker", DecoderWorker);
  const { heicToPdf } = await import("../pdfTools");
  const controller = new AbortController();
  await expect(heicToPdf(new File(["fixture"], "photo.heic"), {
    signal: controller.signal, onProgress: () => controller.abort(),
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(DecoderWorker.instances[0].postMessage).not.toHaveBeenCalled();
  expect(DecoderWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it("terminates unsupported HEIC decoding at its deadline and allows a retry", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", DecoderWorker);
  const { heicToPdf } = await import("../pdfTools");
  const conversion = heicToPdf(new File(["fixture"], "photo.heic"));
  const rejected = expect(conversion).rejects.toThrow("Try exporting it as JPEG or PNG.");
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(DecoderWorker.instances[0].terminate).toHaveBeenCalledOnce();
  const retry = heicToPdf(new File(["fixture"], "photo.heic"));
  DecoderWorker.instances[1].onmessage?.({ data: { error: "Unsupported image" } } as MessageEvent);
  await expect(retry).rejects.toThrow("Unsupported image");
  expect(DecoderWorker.instances[1].terminate).toHaveBeenCalledOnce();
});
