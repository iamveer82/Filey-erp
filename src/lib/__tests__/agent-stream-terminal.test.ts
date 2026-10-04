import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiAgentStream, setAiConfig } from "../ai";
import { runAgentStream } from "../agentHarness";
import * as storage from "../agentStorage";
import { agentStorageKey, agentStorageScope } from "../agentStorage";
import { endTurn, setTurnFiles } from "../aiTools";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { runRemoteAgentTurn } from "../remoteAgentTurn";

// Exercise the real stream wrapper, progress store and remote file handoff.
// Inject only the provider/tool stream; no live model or business records.
vi.mock("../agentHarness", () => ({ runAgentStream: vi.fn() }));
vi.mock("../aiContext", () => ({ buildAiContext: async () => "" }));

const output = { name: "demo-invoice.pdf", path: "C:/Filey/demo-invoice.pdf" };
const toolCall = { type: "tool_call" as const, id: "export-demo", name: "export_invoice_pdf", args: { number: "INV-DEMO" } };
const toolResult = { type: "tool_result" as const, id: "export-demo", name: "export_invoice_pdf", result: { invoice_id: 7, number: "INV-DEMO" } };

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg(null);
  setCacheOrg("terminal-test-org", "terminal-test-user");
  setAiConfig({ provider: "openai", model: "fixture", baseUrl: "https://example.test/v1", apiKey: "fixture-only" });
  vi.mocked(runAgentStream).mockReset();
});
afterEach(() => { vi.restoreAllMocks(); setCacheOrg(null); });

function progress() {
  return JSON.parse(localStorage.getItem(agentStorageKey("filey.agent.progress")!) || "[]") as {
    agentId: string; outcome: string; actions: { id: string; status: string; references?: Record<string, unknown> }[];
  }[];
}
function terminalWrites(writes: { mock: { calls: Parameters<typeof storage.writeAgentStorage>[] } }, outcome: string) {
  return writes.mock.calls.filter(([key, value]) => key === "filey.agent.progress" && typeof value === "string"
    && JSON.parse(value).some((row: { outcome: string }) => row.outcome === outcome));
}

it("closes a provider failure once while returning files already produced to the remote transport", async () => {
  const writes = vi.spyOn(storage, "writeAgentStorage");
  vi.mocked(runAgentStream).mockImplementation(async function* (_messages, opts) {
    yield toolCall;
    setTurnFiles(opts.turnId!, [], [output]);
    yield toolResult;
    throw new Error("Private provider response detail");
  });
  const result = await runRemoteAgentTurn({ scope: agentStorageScope()!, channel: "whatsapp", conversationId: "demo-owner",
    text: "Export INV-DEMO", signal: new AbortController().signal, deadline: Date.now() + 30_000, isCurrent: () => true });
  expect(result.files).toEqual([output]);
  expect(result.text).not.toContain("Private provider response detail");
  expect(progress()).toEqual([expect.objectContaining({ agentId: "whatsapp:demo-owner", outcome: "error",
    actions: [expect.objectContaining({ id: "export-demo", status: "completed", references: { invoice_id: 7, number: "INV-DEMO" } })] })]);
  expect(terminalWrites(writes, "error")).toHaveLength(1);
  result.delivered();
  result.delivered();
  expect(terminalWrites(writes, "error")).toHaveLength(1);
});

it("records stopped on an early consumer close and leaves completed output available", async () => {
  const writes = vi.spyOn(storage, "writeAgentStorage");
  const closed = vi.fn();
  vi.mocked(runAgentStream).mockImplementation(async function* (_messages, opts) {
    try {
      yield toolCall;
      setTurnFiles(opts.turnId!, [], [output]);
      yield toolResult;
      yield { type: "text", text: "Preparing the final reply." };
      return "Done";
    } finally { closed(); }
  });
  const stream = aiAgentStream([{ role: "user", text: "Export INV-DEMO" }], { isOwner: true, agentId: "stopped-demo", turnId: "stopped-demo-turn" });
  await stream.next();
  await stream.next();
  await stream.return("");
  await stream.return("");
  expect(closed).toHaveBeenCalledOnce();
  expect(progress()[0]).toMatchObject({ outcome: "stopped", actions: [{ id: "export-demo", status: "completed" }] });
  expect(terminalWrites(writes, "stopped")).toHaveLength(1);
  expect(endTurn("stopped-demo-turn")).toEqual([output]);
  expect(endTurn("stopped-demo-turn")).toEqual([]);
});

it("keeps an approval pause's existing terminal outcome when its consumer closes", async () => {
  const writes = vi.spyOn(storage, "writeAgentStorage");
  vi.mocked(runAgentStream).mockImplementation(async function* () {
    yield toolCall;
    yield { ...toolResult, result: { pending_action: "Approve the exact action" } };
    yield { type: "done", text: "Please approve the action.", reason: "blocked" };
    return "Please approve the action.";
  });
  const stream = aiAgentStream([{ role: "user", text: "Send the invoice" }], { isOwner: true, agentId: "approval-demo" });
  await stream.next();
  await stream.next();
  await stream.next();
  await stream.return("");
  expect(progress()[0]).toMatchObject({ outcome: "blocked", actions: [{ id: "export-demo", status: "waiting" }] });
  expect(terminalWrites(writes, "blocked")).toHaveLength(1);
  expect(terminalWrites(writes, "stopped")).toHaveLength(0);
  expect(terminalWrites(writes, "error")).toHaveLength(0);
});

it("never finalizes or exposes old outputs in a different active account", async () => {
  const writes = vi.spyOn(storage, "writeAgentStorage");
  const originalScope = agentStorageScope()!;
  const originalKey = agentStorageKey("filey.agent.progress")!;
  vi.mocked(runAgentStream).mockImplementation(async function* (_messages, opts) {
    yield toolCall;
    setTurnFiles(opts.turnId!, [], [output]);
    yield toolResult;
    setCacheOrg("different-org", "different-user");
    throw new Error("Provider failed after the account switch");
  });
  await expect(runRemoteAgentTurn({ scope: originalScope, channel: "telegram", conversationId: "demo-owner",
    text: "Export INV-DEMO", signal: new AbortController().signal, deadline: Date.now() + 30_000, isCurrent: () => true }))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(progress()).toEqual([]);
  expect(JSON.parse(localStorage.getItem(originalKey)!)[0]).toMatchObject({ outcome: "running", actions: [{ status: "completed" }] });
  expect(terminalWrites(writes, "error")).toHaveLength(0);
  expect(terminalWrites(writes, "stopped")).toHaveLength(0);
});
