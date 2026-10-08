import { afterEach, expect, it, vi } from "vitest";
import { extractInvoiceFromImage, setAiConfig } from "../ai";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import * as credentials from "../credentialStore";

afterEach(() => { setCacheOrg(null); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("never dispatches a cancelled scan when a delayed credential read finishes", async () => {
  localStorage.clear(); setDataMode("local"); setCacheOrg("scan-org", "scan-user");
  setAiConfig({ provider: "openai", baseUrl: "https://api.example.test/v1", model: "vision-model" });
  let finish!: (key: string) => void;
  vi.spyOn(credentials, "readCredential").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  const controller = new AbortController();
  const pending = extractInvoiceFromImage({ mediaType: "image/png", dataBase64: "private-document" }, { signal: controller.signal });
  expect(finish).toBeTypeOf("function");
  controller.abort();
  finish("fixture-key");
  await expect(pending).rejects.toHaveProperty("name", "AbortError");
  expect(network).not.toHaveBeenCalled();
});
