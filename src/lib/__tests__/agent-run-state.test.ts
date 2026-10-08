import { beforeEach, expect, it, vi } from "vitest";
const identity = vi.hoisted(() => ({ scope: "org:user:alice" }));
vi.mock("../api", () => ({ getCacheScope: () => identity.scope }));
import { agentStorageScope, readAgentStorage } from "../agentStorage";
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

const progress = () => JSON.parse(readAgentStorage("filey.agent.progress")!)[0];

it.each([
  { result: { ok: true, id: 29, number: "INV-029" }, status: "completed" },
  { result: { error: "Response lost", invoice_number: "INV-029", retry_safe: false }, status: "unconfirmed" },
])("retains a $status invoice receipt when a read-only follow-up fails", ({ result, status }) => {
  const scope = agentStorageScope()!;
  const invoice = agentProgressRecorder("chat-1", scope);
  invoice({ type: "tool_call", id: "save", name: "create_invoice_draft", args: { secret: "private" } });
  invoice({ type: "tool_result", id: "save", name: "create_invoice_draft", result });
  invoice({ type: "done", text: "", reason: "stopped" });
  const original = progress();
  const followup = agentProgressRecorder("chat-1", scope);
  followup({ type: "tool_call", id: "read", name: "list_invoices", args: {} });
  followup({ type: "tool_result", id: "read", name: "list_invoices", result: [{ id: 29, number: "INV-029" }] });
  followup({ type: "done", text: "", reason: "error" });

  const saved = progress();
  expect(saved).toMatchObject({ outcome: "error", actions: [{ id: "read", name: "list_invoices", status: "completed" }],
    earlierWrites: [{ runId: original.runId, at: original.at, outcome: "stopped", action: { name: "create_invoice_draft", status } }] });
  expect(saved.runId).not.toBe(original.runId);
  expect(priorAgentProgress("chat-1")).toContain("INV-029");
  expect(priorAgentProgress("chat-1")).toContain("not work completed by the latest run");
  expect(JSON.stringify(saved)).not.toContain("private");
  expect(priorAgentProgress("chat-2")).toBe("");
  identity.scope = "org:user:bob";
  expect(priorAgentProgress("chat-1")).toBe("");
  expect(() => followup({ type: "done", text: "", reason: "answered" })).not.toThrow();
  expect(priorAgentProgress("chat-1")).toBe("");
  identity.scope = "org:user:alice";
  expect(progress()).toEqual(saved);
});

it("keeps uncertain outbound receipts and current incomplete actions separate when tool IDs are reused", () => {
  const scope = agentStorageScope()!;
  const outbound = agentProgressRecorder("chat-1", scope);
  outbound({ type: "tool_call", id: "same-id", name: "send_invoice", args: {} });
  outbound({ type: "tool_result", id: "same-id", name: "send_invoice", result: { error: "Response lost", invoice_id: 29, retry_safe: false } });
  outbound({ type: "done", text: "", reason: "error" });
  const next = agentProgressRecorder("chat-1", scope);
  next({ type: "tool_call", id: "same-id", name: "create_invoice_draft", args: {} });
  expect(progress()).toMatchObject({ actions: [{ status: "started" }], earlierWrites: [{ action: { name: "send_invoice", status: "unconfirmed" } }] });
  next({ type: "tool_result", id: "same-id", name: "create_invoice_draft", result: { ok: true, id: 30, number: "INV-030" } });
  expect(progress()).toMatchObject({ actions: [{ status: "completed", references: { id: 30, number: "INV-030" } }],
    earlierWrites: [{ action: { name: "send_invoice", status: "unconfirmed", references: { invoice_id: 29 } } }] });
});

it("never lets a superseded recorder overwrite the new run or upgrade its historical incomplete receipt", () => {
  const scope = agentStorageScope()!;
  const old = agentProgressRecorder("chat-1", scope);
  old({ type: "tool_call", id: "save", name: "create_invoice_draft", args: {} });
  const next = agentProgressRecorder("chat-1", scope);
  next({ type: "tool_call", id: "read", name: "list_invoices", args: {} });
  const current = progress();
  old({ type: "tool_result", id: "save", name: "create_invoice_draft", result: { ok: true, id: 29, number: "INV-029" } });
  old({ type: "done", text: "", reason: "answered" });
  expect(progress()).toEqual(current);
  expect(current).toMatchObject({ actions: [{ status: "started", name: "list_invoices" }],
    earlierWrites: [{ outcome: "running", action: { status: "started", name: "create_invoice_draft" } }] });
});

it("bounds earlier receipts by count and keeps read-only and planning follow-ups from evicting writes", () => {
  const scope = agentStorageScope()!;
  for (let i = 0; i < 30; i++) {
    const record = agentProgressRecorder("chat-1", scope);
    record({ type: "tool_call", id: "save", name: "create_invoice_draft", args: {} });
    record({ type: "tool_result", id: "save", name: "create_invoice_draft", result: { id: i + 1, number: `INV-${i + 1}` } });
    record({ type: "done", text: "", reason: "answered" });
  }
  for (let i = 0; i < 30; i++) {
    const record = agentProgressRecorder("chat-1", scope);
    for (const name of ["list_invoices", "update_plan"]) {
      record({ type: "tool_call", id: name, name, args: {} });
      record({ type: "tool_result", id: name, name, result: [] });
    }
    record({ type: "done", text: "", reason: "error" });
  }
  const earlier = progress().earlierWrites;
  expect(earlier).toHaveLength(24);
  expect(earlier.map((receipt: { action: { references: { id: number } } }) => receipt.action.references.id))
    .toEqual(Array.from({ length: 24 }, (_, index) => index + 7));
  clearAgentProgress("chat-1", scope);
  expect(priorAgentProgress("chat-1")).toBe("");
});

it("caps retained receipt bytes and includes only the existing reference allowlist", () => {
  const scope = agentStorageScope()!;
  const refs = Object.fromEntries(["id", "number", "invoice_id", "invoice_number", "customer_id", "order_id", "quote_id", "job_id", "record_id"]
    .map(key => [key, "x".repeat(80)]));
  for (let i = 0; i < 30; i++) {
    const record = agentProgressRecorder("chat-1", scope);
    record({ type: "tool_call", id: "i".repeat(160), name: "create_invoice_draft", args: {} });
    record({ type: "tool_result", id: "i".repeat(160), name: "create_invoice_draft", result: { ...refs, secret: "private", text: "x".repeat(100_000) } });
    record({ type: "done", text: "", reason: "answered" });
  }
  const earlier = progress().earlierWrites;
  expect(earlier.length).toBeGreaterThan(0);
  expect(earlier.length).toBeLessThan(24);
  expect(new TextEncoder().encode(JSON.stringify(earlier)).length).toBeLessThanOrEqual(16_384);
  expect(JSON.stringify(earlier)).not.toContain("private");
});
