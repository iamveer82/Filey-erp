import { beforeEach, expect, it, vi } from "vitest";
const identity = vi.hoisted(() => ({ scope: "org:user:alice" }));
vi.mock("../api", () => ({ getCacheScope: () => identity.scope }));
import { agentStorageScope } from "../agentStorage";
import { agentProgressRecorder, clearAgentProgress, priorAgentProgress } from "../agentRunState";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  identity.scope = "org:user:alice";
});

it("keeps pending calls and record IDs without persisting arguments, credentials or result bodies", () => {
  const record = agentProgressRecorder("chat-1", agentStorageScope()!);
  record({ type: "tool_call", id: "1", name: "create_invoice_draft", args: { password: "private-secret" } });
  expect(priorAgentProgress("chat-1")).toContain('"status":"started"');
  record({ type: "tool_result", id: "1", name: "create_invoice_draft", result: {
    id: "invoice-42", number: "INV-42", api_key: "private-secret", image: "secret-pixels", url: "https://secret.test",
  } });
  expect(priorAgentProgress("chat-1")).toContain("invoice-42");
  expect(priorAgentProgress("chat-1")).toContain('"status":"completed"');
  expect(JSON.stringify(localStorage)).not.toMatch(/private-secret|secret-pixels|secret.test/);
  expect(priorAgentProgress("chat-2")).toBe("");
  identity.scope = "org:user:bob";
  expect(priorAgentProgress("chat-1")).toBe("");
  expect(() => record({ type: "tool_call", id: "2", name: "get_stats", args: {} })).not.toThrow();
  expect(priorAgentProgress("chat-1")).toBe("");
});

it("preserves approval waits and uncertain actions across follow-ups and clears them on new chat", () => {
  const scope = agentStorageScope()!;
  const record = agentProgressRecorder("whatsapp:123", scope);
  record({ type: "tool_call", id: "1", name: "create_video_draft", args: {} });
  record({ type: "tool_result", id: "1", name: "create_video_draft", result: { job_id: "job-1", pending_action: "media_approval", retry_safe: false } });
  record({ type: "tool_call", id: "2", name: "send_invoice", args: {} });
  record({ type: "tool_result", id: "2", name: "send_invoice", result: { error: "Network failed", retry_safe: false } });
  record({ type: "done", reason: "blocked", text: "Need confirmation" });
  const prior = priorAgentProgress("whatsapp:123");
  expect(prior).toContain('"status":"waiting"');
  expect(prior).toContain('"status":"unconfirmed"');
  agentProgressRecorder("whatsapp:123", scope)({ type: "done", reason: "answered", text: "Hello" });
  expect(priorAgentProgress("whatsapp:123")).toBe(prior);
  clearAgentProgress("whatsapp:123", scope);
  expect(priorAgentProgress("whatsapp:123")).toBe("");
});
