import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AiSettings from "../AiSettings";
import { aiAgent, aiChat, aiReady, getAiConfig, listLocalAiModels, setAiConfig, type AiConfig } from "../../lib/ai";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast }) }));

const local: AiConfig = { provider: "openai", baseUrl: "http://localhost:11434/v1", model: "local-model", apiKey: "" };
const reply = () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200 });
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("allows keyless loopback models without treating remote or misleading hosts as local", () => {
  for (const baseUrl of [local.baseUrl, "http://127.0.0.1:1234/v1", "http://[::1]:1234/v1"])
    expect(aiReady({ ...local, baseUrl })).toBe(true);
  for (const baseUrl of ["https://ollama.com/v1", "https://localhost.example/v1", "http://localhost@remote.example/v1", "invalid", "file:///v1"])
    expect(aiReady({ ...local, baseUrl })).toBe(false);
  expect(aiReady({ ...local, model: " " })).toBe(false);
  expect(aiReady({ ...local, provider: "anthropic" })).toBe(false);
});

it("clears an old provider key on origin changes and preserves an explicitly supplied replacement", () => {
  setAiConfig({ ...local, baseUrl: "https://one.example/v1", apiKey: "first-provider-key" });
  expect(setAiConfig({ baseUrl: "https://one.example/custom/v1/" }).apiKey).toBe("first-provider-key");
  expect(setAiConfig({ baseUrl: "https://two.example/v1" }).apiKey).toBe("");
  expect(setAiConfig({ baseUrl: "https://three.example/v1", apiKey: "replacement-key" }).apiKey).toBe("replacement-key");
  expect(setAiConfig({ baseUrl: local.baseUrl }).apiKey).toBe("");
});

it("uses keyless local chat and agent requests without an empty authorization header", async () => {
  setAiConfig(local);
  const fetchMock = vi.fn(async () => reply());
  vi.stubGlobal("fetch", fetchMock);
  expect(await aiChat([{ role: "user", text: "Hello" }])).toBe("ok");
  expect(await aiAgent([{ role: "user", text: "Hello" }])).toBe("ok");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][])
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  setAiConfig({ apiKey: "local-server-token" });
  await aiChat([{ role: "user", text: "Hello" }]);
  const [, authenticated] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
  expect(new Headers(authenticated.headers).get("authorization")).toBe("Bearer local-server-token");
});

it("reads only the local model catalogue and rejects malformed responses", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "qwen" }, { id: "qwen" }, { id: 1 }, null] })));
  vi.stubGlobal("fetch", fetchMock);
  expect(await listLocalAiModels(local)).toEqual(["qwen"]);
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/v1/models", expect.objectContaining({ method: "GET" }));
  expect(getAiConfig().apiKey).toBe("");
  await expect(listLocalAiModels({ ...local, baseUrl: "https://remote.example/v1" })).rejects.toThrow("local");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValueOnce(new Response("{}"));
  await expect(listLocalAiModels(local)).rejects.toThrow("invalid model list");
});

it("makes local setup testable without a key and clears the hosted key when choosing it", async () => {
  setAiConfig({ ...local, baseUrl: "https://api.openai.com/v1", apiKey: "hosted-key" });
  const fetchMock = vi.fn(async () => reply());
  vi.stubGlobal("fetch", fetchMock);
  render(<AiSettings />);
  fireEvent.change(screen.getByLabelText("Provider preset"), { target: { value: "Ollama (local)" } });
  expect(screen.getByLabelText("API key (optional)")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "installed-model" } });
  expect(screen.getByRole("button", { name: "Test connection" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://localhost:11434/v1/chat/completions");
  expect(new Headers(init.headers).has("authorization")).toBe(false);
  expect(JSON.parse(String(init.body)).messages).toEqual([{ role: "user", content: "Reply with the single word: ok" }]);
});

it("offers a free hosted preset while still requiring the user's own key", () => {
  render(<AiSettings />);
  fireEvent.change(screen.getByLabelText("Provider preset"), { target: { value: "OpenRouter · free models" } });
  expect(screen.getByLabelText("Model")).toHaveValue("openrouter/free");
  expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  expect(screen.queryByText(/AI Briefing/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Get your API key" })).toHaveAttribute("href", "https://openrouter.ai/settings/keys");
});

it("offers Gemini's free-tier model without fabricating a provider key", () => {
  render(<AiSettings />);
  fireEvent.change(screen.getByLabelText("Provider preset"), { target: { value: "Google Gemini" } });
  expect(screen.getByLabelText("Model")).toHaveValue("gemini-2.5-flash");
  expect(screen.getByRole("link", { name: "Get your API key" })).toHaveAttribute("href", "https://aistudio.google.com/apikey");
  expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  expect(screen.getByText(/Google may use free-tier content/)).toBeInTheDocument();
});

it("lets the user select a discovered local model without starting inference", async () => {
  setAiConfig({ ...local, model: "" });
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "installed-qwen" }] })));
  vi.stubGlobal("fetch", fetchMock);
  render(<AiSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Find local models" }));
  const models = await screen.findByRole("button", { name: "Available local models" });
  fireEvent.click(models);
  fireEvent.click(screen.getByRole("menuitem", { name: "installed-qwen" }));
  expect(screen.getByLabelText("Model")).toHaveValue("installed-qwen");
  expect(screen.getByRole("button", { name: "Test connection" })).toBeEnabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/v1/models", expect.objectContaining({ method: "GET" }));
});
