import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runTool } from "../aiTools";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { setAgentMode } from "../agentMode";

const fixture = vi.hoisted(() => ({
  resolveSecrets: vi.fn(), send: vi.fn(), access: vi.fn(),
}));
vi.mock("../secretStore", async importOriginal => ({
  ...(await importOriginal<typeof import("../secretStore")>()),
  secretSubstitutions: fixture.resolveSecrets,
}));
vi.mock("../reach", async importOriginal => ({
  ...(await importOriginal<typeof import("../reach")>()), httpFetch: fixture.send,
}));
vi.mock("../moduleAccess", () => ({ requireToolModuleAccess: fixture.access }));

const args = { url: "https://customer.example/action", method: "POST", body: "approved business message", headers: { authorization: "Bearer {{secret:token}}" } };
const secrets = {
  fill: (text: string) => ({ text: text.replace("{{secret:token}}", "fixture-private-key"), used: ["token"], missing: [] }),
  redact: (text: string) => text.split("fixture-private-key").join("[REDACTED]"),
};
beforeEach(() => {
  localStorage.clear(); setDataMode("local"); setCacheOrg("org-a", "user-a");
  setAgentMode("auto"); vi.clearAllMocks();
  fixture.access.mockResolvedValue(undefined);
  fixture.send.mockResolvedValue({ status: 200, body: "echo fixture-private-key" });
});
afterEach(() => { setCacheOrg(null); vi.restoreAllMocks(); });

it.each(["Stop", "workspace", "Plan", "permission"])("does not dispatch approved HTTP when %s changes during secret resolution", async change => {
  let finish!: (value: typeof secrets) => void;
  fixture.resolveSecrets.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = runTool("http_fetch", args, () => true, true, undefined, controller.signal);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  if (change === "Stop") controller.abort();
  else if (change === "workspace") setCacheOrg("org-b", "user-a");
  else if (change === "Plan") setAgentMode("plan");
  else fixture.access.mockRejectedValue(new Error("Access revoked"));
  finish(secrets);
  if (["Stop", "workspace"].includes(change))
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  else expect(await pending).toMatchObject({ error: expect.any(String) });
  expect(fixture.send).not.toHaveBeenCalled();
});

it("dispatches a stable approved HTTP request with its abort signal and redacts provider echoes", async () => {
  fixture.resolveSecrets.mockResolvedValueOnce(secrets);
  const controller = new AbortController();
  const result = await runTool("http_fetch", args, () => true, true, undefined, controller.signal);
  expect(fixture.send).toHaveBeenCalledOnce();
  expect(fixture.send).toHaveBeenCalledWith(args.url, expect.objectContaining({
    signal: controller.signal, method: "POST", body: args.body,
    headers: { authorization: "Bearer fixture-private-key" },
  }));
  expect(result).toMatchObject({ status: 200, body: "echo [REDACTED]" });
});
