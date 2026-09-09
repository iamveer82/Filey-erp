import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentStream, type AgentEvent, type HarnessOpts } from "../agentHarness";
import { runTool } from "../aiTools";
import type { AiConfig } from "../ai";
import { compressForModel, headroomReset } from "../headroom";

vi.mock("../aiTools", () => ({ TOOLS: [], runTool: vi.fn() }));
vi.mock("../capabilities", () => ({ isToolAllowed: () => true }));
vi.mock("../agentMode", () => ({ gateFor: () => "run" }));
vi.mock("../agentStorage", () => ({ agentStorageScope: () => "local:test" }));

const config: AiConfig = {
  provider: "openai",
  apiKey: "test",
  model: "test-model",
  baseUrl: "https://example.test/v1",
};
const call = (name: string, args: unknown = {}, id = name) => ({
  id,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
const turn = (calls: ReturnType<typeof call>[] = [], content = "") => ({
  choices: [{ message: { role: "assistant", content, tool_calls: calls } }],
});
const finish = {
  name: "task_complete",
  description: "Finish",
  parameters: { type: "object", properties: {} },
};

async function run(replies: unknown[], opts: HarnessOpts = {}, cfg = config) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  });
  const events: AgentEvent[] = [];
  const stream = runAgentStream(
    [
      { role: "system", text: "Never disclose private data." },
      { role: "user", text: "Do the task" },
    ],
    opts,
    { cfg, fetchFn }
  );
  for (;;) {
    const next = await stream.next();
    if (next.done) return { events, text: next.value, requests };
    events.push(next.value);
  }
}

beforeEach(() => vi.mocked(runTool).mockReset().mockResolvedValue({ ok: true }));

describe("advanced agent runtime", () => {
  it("does not execute malformed tool arguments", async () => {
    const result = await run([
      turn([call("create_invoice_draft", "{broken")]),
      turn([], "Corrected."),
    ]);
    expect(runTool).not.toHaveBeenCalled();
    expect(JSON.stringify(result.requests[1])).toContain("valid JSON object");
  });

  it("stops a remaining tool batch after cancellation", async () => {
    const controller = new AbortController();
    vi.mocked(runTool).mockImplementationOnce(async () => {
      controller.abort();
      return { ok: true };
    });
    await expect(
      run([turn([call("get_stats"), call("create_invoice_draft")])], {
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it("rejects a canceled native provider response before its tool runs", async () => {
    const controller = new AbortController();
    const stream = runAgentStream(
      [{ role: "user", text: "test" }],
      { signal: controller.signal },
      {
        cfg: config,
        fetchFn: async () => {
          controller.abort();
          return new Response(JSON.stringify(turn([call("create_invoice_draft")])));
        },
      }
    );
    await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(runTool).not.toHaveBeenCalled();
  });

  it("keeps a real checklist and refuses completion with unfinished steps", async () => {
    const step = { step: "Verify the invoice", status: "in_progress" };
    const result = await run(
      [
        turn([call("update_plan", { steps: [step] })]),
        turn([call("task_complete", { summary: "Done" })]),
        turn([call("update_plan", { steps: [{ ...step, status: "completed" }] })]),
        turn([call("task_complete", { summary: "Verified." })]),
      ],
      { finishToolName: "task_complete", extraTools: [finish] }
    );
    expect(result.events.filter((e) => e.type === "plan")).toHaveLength(2);
    expect(JSON.stringify(result.requests[2])).toContain("unfinished steps");
    expect(result.events[result.events.length - 1]).toMatchObject({
      type: "done",
      reason: "finished",
      text: "Verified.",
    });
  });

  it("reports blocked work without calling it completed", async () => {
    const result = await run(
      [turn([call("task_complete", { summary: "Need a customer.", status: "blocked" })])],
      { finishToolName: "task_complete", extraTools: [finish] }
    );
    expect(result.events[result.events.length - 1]).toMatchObject({
      type: "done",
      reason: "blocked",
    });
  });

  it("contains delegation, inherits constraints and emits only one parent completion", async () => {
    const result = await run(
      [
        turn([call("spawn_subtask", { goal: "Review stock" })]),
        turn([call("spawn_subtask", { goal: "Recurse" })]),
        turn([], "Stock reviewed."),
        turn([call("get_stats")]),
        turn([], "All reviewed."),
      ],
      { isOwner: true }
    );
    expect(JSON.stringify(result.requests[1])).toContain("Never disclose private data.");
    expect(JSON.stringify(result.requests[2])).toContain("Sub-agents cannot delegate");
    expect(result.events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(result.text).toBe("All reviewed.");
  });

  it("does not retrieve compressed outputs from a previous run", async () => {
    headroomReset();
    const privateOutput = JSON.stringify(
      Array.from({ length: 80 }, (_, id) => ({
        id,
        account: "another-workspace-private",
      }))
    );
    const old = compressForModel("list_customers", privateOutput);
    expect(old.ccrId).toBeTruthy();
    const result = await run([
      turn([call("headroom_retrieve", { id: old.ccrId })]),
      turn([], "I need to look up records in this task."),
    ]);
    expect(JSON.stringify(result.events)).toContain("does not belong to this run");
    expect(JSON.stringify(result.requests)).not.toContain("another-workspace-private");
    expect(runTool).not.toHaveBeenCalled();
  });

  it("shares duplicate-write protection with delegated tasks", async () => {
    const args = { customer_id: "customer-1" };
    const result = await run([
      turn([call("spawn_subtask", { goal: "Prepare this customer's invoice" })]),
      turn([call("create_invoice_draft", args, "child-create")]),
      turn([], "Invoice prepared."),
      turn([call("create_invoice_draft", args, "parent-create")]),
      turn([], "Done."),
    ]);
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(result.events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(JSON.stringify(result.events)).toContain("duplicate");
  });

  it.each(["openai", "anthropic"] as const)(
    "sends fresh screenshots as vision for %s and removes them after observation",
    async (provider) => {
      vi.mocked(runTool).mockResolvedValueOnce({
        snapshot_id: "frame-1",
        image: { mediaType: "image/png", dataBase64: "QUJD" },
      });
      const replies =
        provider === "openai"
          ? [
              turn([call("computer_use", { action: "screenshot" })]),
              turn([call("get_stats")]),
              turn([], "Done"),
            ]
          : [
              {
                stop_reason: "tool_use",
                content: [
                  {
                    type: "tool_use",
                    id: "a",
                    name: "computer_use",
                    input: { action: "screenshot" },
                  },
                ],
              },
              {
                stop_reason: "tool_use",
                content: [{ type: "tool_use", id: "b", name: "get_stats", input: {} }],
              },
              { stop_reason: "end_turn", content: [{ type: "text", text: "Done" }] },
            ];
      const result = await run(replies, {}, { ...config, provider });
      expect(JSON.stringify(result.requests[1])).toContain("QUJD");
      expect(JSON.stringify(result.requests[2])).not.toContain("QUJD");
      expect(JSON.stringify(result.events)).not.toContain("QUJD");
      if (provider === "anthropic")
        expect(result.requests[0].url).toBe("https://example.test/v1/messages");
    }
  );
});
