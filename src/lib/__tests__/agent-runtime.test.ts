import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentStream, type AgentEvent, type HarnessOpts } from "../agentHarness";
import { runTool } from "../aiTools";
import type { AiConfig } from "../ai";
import { compressForModel, headroomReset } from "../headroom";

vi.mock("../aiTools", () => ({ TOOLS: [], runTool: vi.fn(), isToolArgumentRejection: () => false, isRemoteAgentRun: (id?: string) => /^(whatsapp|telegram):/.test(id ?? "") }));
vi.mock("../capabilities", () => ({ isToolAllowed: () => true }));
vi.mock("../agentMode", () => ({ gateFor: () => "run" }));
vi.mock("../agentStorage", () => ({ agentStorageScope: () => "local:test", AGENT_STORAGE_EVENT: "filey:agent-storage" }));

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

async function run(replies: unknown[], opts: HarnessOpts = {}, cfg = config, userRequest = "Do the task") {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  });
  const events: AgentEvent[] = [];
  const stream = runAgentStream(
    [
      { role: "system", text: "Never disclose private data." },
      { role: "user", text: userRequest },
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
  it.each([false, true])("does not publish rollback claims or retry altered invoice data after a timeout (autonomous=%s)", async autonomous => {
    vi.mocked(runTool).mockResolvedValueOnce({ error: "Statement timeout", save_outcome: "unconfirmed", retry_safe: false, invoice_number: "INV-1" });
    const misleading = "Nothing was saved, so there is no duplicate risk. I removed T.Liters and increased the rate.";
    const result = await run([
      turn([call("create_invoice_draft", { customer_name: "Acme", items: [{ qty: 6, unit_price: 0.2, custom: { liters: "1200" } }] }, "first")]),
      turn([call("create_invoice_draft", { customer_name: "Acme", items: [{ qty: 6, unit_price: 200 }] }, "changed")], misleading),
      autonomous ? turn([call("task_complete", { status: "blocked", summary: misleading })]) : turn([], misleading),
    ], autonomous ? { finishToolName: "task_complete", extraTools: [finish] } : {}, config, "Create an invoice for Acme: 6 drums, T.Liters 1200, rate 0.20 per litre.");
    expect(runTool).toHaveBeenCalledOnce();
    expect(result.text).toContain("save could not be confirmed");
    expect(result.text).toContain("may already exist");
    expect(result.text).toContain("prices, quantities and calculation fields unchanged");
    expect(result.text).not.toContain(misleading);
    expect(result.events.filter(event => event.type === "text")).toEqual([]);
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "blocked" });
  });

  it("continues another requested invoice after the exact pending save is verified", async () => {
    vi.mocked(runTool)
      .mockResolvedValueOnce({ error: "Timeout", save_outcome: "unconfirmed", retry_safe: false, save_request_id: "request-1", invoice_number: "INV-1" })
      .mockResolvedValueOnce({ id: 1, number: "INV-1", verified_save_requests: ["request-1"] })
      .mockResolvedValueOnce({ ok: true, id: 2, number: "INV-2" });
    const result = await run([
      turn([call("create_invoice_draft", { customer_name: "Acme", items: [{ qty: 6, unit_price: 0.2 }] }, "first")]),
      turn([call("get_invoice", { invoice_number: "INV-1" })]),
      turn([call("create_invoice_draft", { customer_name: "Other customer", items: [{ qty: 1, unit_price: 40 }] }, "second")]),
      turn([], "The first invoice is verified and the second invoice was created."),
    ], {}, config, "Create one invoice for Acme and another invoice for Other customer.");
    expect(runTool).toHaveBeenCalledTimes(3);
    expect(result.text).toBe("The first invoice is verified and the second invoice was created.");
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "answered" });
  });

  it("allows an explicitly requested exact retry after discovering a prior turn's pending save", async () => {
    vi.mocked(runTool)
      .mockResolvedValueOnce({ error: "Earlier save is unconfirmed", save_outcome: "unconfirmed", retry_safe: false, save_request_id: "request-1", invoice_number: "INV-1" })
      .mockResolvedValueOnce({ ok: true, id: 1, number: "INV-1", confirmed_save_request: "request-1" })
      .mockResolvedValueOnce({ id: 1, number: "INV-1", items: [{ qty: 6, unit_price: 0.2 }] });
    const result = await run([
      turn([call("create_invoice_draft", { customer_name: "Acme", items: [{ qty: 6, unit_price: 0.2 }] })]),
      turn([call("retry_invoice_save", { request_id: "request-1" })]),
      turn([call("get_invoice", { invoice_number: "INV-1" })]),
      turn([], "The original invoice is now saved and verified."),
    ], {}, config, "Please retry the earlier invoice save with the same details.");
    expect(vi.mocked(runTool).mock.calls.map(([name]) => name)).toEqual(["create_invoice_draft", "retry_invoice_save", "get_invoice"]);
    expect(result.text).toBe("The original invoice is now saved and verified.");
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "answered" });
  });

  it("keeps invoice image details through a managed customer lookup and draft creation without OCR discovery", async () => {
    const item = { description: "RC drum", qty: 1200, unit: "L", unit_price: 0.2 };
    vi.mocked(runTool).mockResolvedValueOnce([{ id: "customer-1", name: "Fixture customer" }])
      .mockResolvedValueOnce({ ok: true, id: "invoice-1", items: [item] });
    const replies = [
      turn([call("find_customers", { query: "Fixture customer" })]),
      turn([call("create_invoice_draft", { customer_id: "customer-1", items: [item] })]),
      turn([], "Draft invoice created."),
    ];
    const requests: string[] = [], events: AgentEvent[] = [];
    const stream = runAgentStream([{ role: "user", text: "Invoice the attached items for Fixture customer", images: [
      { mediaType: "image/png", dataBase64: "QUJD" }, { mediaType: "image/jpeg", dataBase64: "REVG" },
    ] }], { isOwner: true, reasoningEnabled: false }, {
      cfg: { ...config, billing: "credits", model: "filey-ai", apiKey: "" },
      fetchFn: async (_url, init) => { requests.push(String(init.body)); return new Response(JSON.stringify(replies.shift())); },
    });
    for (;;) {
      const step = await stream.next();
      if (step.done) { expect(step.value).toBe("Draft invoice created."); break; }
      events.push(step.value);
    }
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request).toContain("QUJD"); expect(request).toContain("REVG");
    }
    expect(vi.mocked(runTool).mock.calls.map(([name]) => name)).toEqual(["find_customers", "create_invoice_draft"]);
    expect(vi.mocked(runTool).mock.calls[1][1]).toEqual({ customer_id: "customer-1", items: [item] });
    expect(events[events.length - 1]).toMatchObject({ type: "done", reason: "answered" });
  });

  it("does not dispatch quotation or purchase/order probes after a failed requested invoice", async () => {
    vi.mocked(runTool).mockResolvedValueOnce({ error: "The quota has been exceeded." });
    const fallbacks = ["create_quote", "create_order", "create_purchase_order", "create_purchase_invoice_draft"];
    const result = await run([
      turn([call("create_invoice_draft", { customer_name: "Mark" })]),
      turn(fallbacks.map(name => call(name))),
      turn([], "The invoice could not be saved because browser storage is full."),
    ], {}, config, "Create an invoice for Mark for 6 drums at 0.20 per litre.");
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(result.events.filter(event => event.type === "tool_result" && fallbacks.includes(event.name))).toHaveLength(4);
    for (const event of result.events.filter(event => event.type === "tool_result" && fallbacks.includes(event.name)))
      expect(event).toMatchObject({ result: { code: "unrequested_document_fallback", retry_safe: false } });
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "blocked" });
  });

  it("allows a corrected invoice after validation failure while blocking an unrequested quote", async () => {
    const invoiceTool = { name: "create_invoice_draft", description: "Create invoice", parameters: { type: "object", properties: {
      customer_name: { type: "string" }, unit_price: { type: "number", minimum: 0 },
    }, required: ["customer_name", "unit_price"] } };
    const result = await run([
      turn([call("create_invoice_draft", { customer_name: "Mark", unit_price: -1 }, "invalid")]),
      turn([call("create_quote", {}, "fallback")]),
      turn([call("create_invoice_draft", { customer_name: "Mark", unit_price: 0.2 }, "corrected")]),
      turn([], "The requested invoice was created."),
    ], { extraTools: [invoiceTool] }, config, "Create an invoice for Mark.");
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith("create_invoice_draft", { customer_name: "Mark", unit_price: 0.2 }, undefined, undefined, undefined, undefined, undefined, undefined);
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "answered" });
  });

  it("continues a quotation that the user separately requested alongside the invoice", async () => {
    vi.mocked(runTool).mockResolvedValueOnce({ error: "Invoice save failed" }).mockResolvedValueOnce({ ok: true, number: "QT-1" });
    await run([
      turn([call("create_invoice_draft", { customer_name: "Mark" })]),
      turn([call("create_quote", { customer_name: "Alice" })]),
      turn([], "The invoice could not be saved; the requested quotation was created."),
    ], {}, config, "Create an invoice for Mark and a quotation for Alice.");
    expect(runTool).toHaveBeenCalledTimes(2);
  });

  it.each(["INV-1", "INV-2"])("resolves a schema rejection only when the corrected call targets INV-1, not %s", async invoiceNumber => {
    const appearance = { name: "update_invoice_appearance", description: "Edit appearance", parameters: {
      type: "object", properties: { invoice_number: { type: "string" }, stamp_opacity: { type: "number", minimum: 5, maximum: 100 } }, required: ["invoice_number"],
    } };
    const result = await run([
      turn([call(appearance.name, { invoice_number: "INV-1", stamp_opacity: 101 }, "invalid")]),
      turn([call(appearance.name, { invoice_number: invoiceNumber, stamp_opacity: 100 }, "corrected")]),
      turn([], "The appearance was updated."),
    ], { extraTools: [appearance] });
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(result.events.find(event => event.type === "tool_result")).toMatchObject({ result: { code: "invalid_arguments" } });
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: invoiceNumber === "INV-1" ? "answered" : "blocked" });
    expect(result.text).not.toMatch(/update_invoice_appearance|stamp_opacity|Out of range/);
  });

  it.each(["round", "action"])("keeps diagnostics but omits raw tool details from the %s-limit reply", async limit => {
    vi.mocked(runTool).mockResolvedValue({ ok: true, message: "private-provider-body" });
    const result = await run([turn([
      call("create_invoice_draft", { customer_name: "private-argument" }, "first"),
      ...(limit === "action" ? [call("create_invoice_draft", { customer_name: "other" }, "second")] : []),
    ])], limit === "round" ? { maxRounds: 1 } : { budget: { requests: 3, tools: 1 } });
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "exhausted" });
    expect(result.text).not.toMatch(/create_invoice_draft|private-provider-body|private-argument/);
    expect(result.events).toContainEqual(expect.objectContaining({ type: "tool_result", name: "create_invoice_draft", result: { ok: true, message: "private-provider-body" } }));
  });

  it("cannot complete after success for a different invoice hides a failed send", async () => {
    vi.mocked(runTool).mockResolvedValueOnce({ error: "INV-1 delivery unconfirmed", retry_safe: false }).mockResolvedValueOnce({ ok: true });
    const result = await run([
      turn([call("email_invoice", { invoice_number: "INV-1" }, "first")]),
      turn([call("email_invoice", { invoice_number: "INV-2" }, "second")]),
      turn([call("task_complete", { summary: "Both invoices sent" })]),
      turn([call("task_complete", { summary: "INV-1 needs verification; INV-2 was accepted.", status: "blocked" })]),
    ], { finishToolName: "task_complete", extraTools: [finish] });
    expect(JSON.stringify(result.requests[3])).toContain("failed actions");
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "blocked" });
  });

  it("keeps every fresh batch result intact, then offers retrieval after observation", async () => {
    headroomReset();
    vi.mocked(runTool)
      .mockResolvedValueOnce({ body: "a".repeat(600), tail: "FIRST_TAIL" })
      .mockResolvedValueOnce({ body: "b".repeat(600), tail: "SECOND_TAIL" });
    const result = await run([
      turn([call("get_stats"), call("list_customers")]),
      turn([call("recall")]),
      turn([], "Verified"),
    ]);
    expect(JSON.stringify(result.requests[1])).toContain("FIRST_TAIL");
    expect(JSON.stringify(result.requests[1])).toContain("SECOND_TAIL");
    expect(JSON.stringify(result.requests[2])).not.toContain("FIRST_TAIL");
    expect(JSON.stringify(result.requests[2])).toContain("Earlier observation");
    expect(JSON.stringify(result.requests[2].body.tools)).toContain("headroom_retrieve");
  });

  it("continues unfinished plans after a premature text answer and stops after bounded checks", async () => {
    const result = await run([
      turn([call("update_plan", { steps: [{ step: "Verify stock", status: "in_progress" }] })]),
      turn([], "Done"), turn([], "Done"), turn([], "Done"),
    ]);
    expect(result.requests).toHaveLength(4);
    expect(JSON.stringify(result.requests[2])).toContain("Execution check");
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "blocked" });
  });

  it("validates internal tool arguments before changing a plan", async () => {
    const result = await run([
      turn([call("update_plan", { steps: "incorrect" })]), turn([], "Correct the plan"),
    ]);
    expect(result.events.some(e => e.type === "plan")).toBe(false);
    expect(JSON.stringify(result.requests[1])).toContain("must be array");
  });

  it("honors Stop while suspended at a recorded call, before dispatch", async () => {
    const controller = new AbortController();
    const stream = runAgentStream([{ role: "user", text: "Create invoice" }], { signal: controller.signal }, {
      cfg: config,
      fetchFn: async () => new Response(JSON.stringify(turn([call("create_invoice_draft")]))),
    });
    expect((await stream.next()).value).toMatchObject({ type: "tool_call" });
    controller.abort();
    await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(runTool).not.toHaveBeenCalled();
  });

  it("contains unexpected tool failures without repeating an uncertain write", async () => {
    vi.mocked(runTool).mockRejectedValueOnce(new Error("Lost connection after writing"));
    const result = await run([
      turn([call("create_invoice_draft", { customer_id: "1" }, "a")]),
      turn([call("create_invoice_draft", { customer_id: "1" }, "b")]),
      turn([], "The result needs verification"),
    ]);
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(result.events.find(e => e.type === "tool_result")).toMatchObject({ result: { retry_safe: false } });
    expect(JSON.stringify(result.requests[2])).toContain("not repeating");
  });
  it("does not report an unfulfilled tool action as completed even if the model says Done", async () => {
    vi.mocked(runTool).mockResolvedValueOnce({ error: "The user did not approve sending." });
    const result = await run([turn([call("send_invoice", { invoice_number: "INV-1" })]), turn([], "Sent!")]);
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "blocked" });
    expect(result.text).toContain("Some requested work could not be completed or confirmed.");
    expect(result.text).not.toContain("send_invoice");
  });
  it.each(["openai", "anthropic"] as const)("rejects duplicate provider call IDs before any %s batch action runs", async provider => {
    const reply = provider === "openai" ? turn([call("create_invoice_draft", {}, "same"), call("get_stats", {}, "same")])
      : { stop_reason: "tool_use", content: [{ type: "tool_use", id: "same", name: "create_invoice_draft", input: {} }, { type: "tool_use", id: "same", name: "get_stats", input: {} }] };
    const result = await run([reply], {}, { ...config, provider });
    expect(runTool).not.toHaveBeenCalled();
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "error" });
    expect(result.text).toContain("Nothing was executed");
  });
  it("bounds a single provider batch and does not label an empty response successful", async () => {
    const excessive = await run([turn(Array.from({ length: 33 }, (_, index) => call("get_stats", {}, String(index))))]);
    expect(excessive.text).toContain("Nothing was executed");
    expect(excessive.text).not.toContain("tool calls");
    expect(runTool).not.toHaveBeenCalled();
    const empty = await run([turn()]);
    expect(empty.events[0]).toMatchObject({ type: "done", reason: "error", text: "Filey AI returned no answer. Please try again." });
  });

  it("does not execute malformed tool arguments", async () => {
    const result = await run([
      turn([call("create_invoice_draft", "{broken")]),
      turn([], "Corrected."),
    ]);
    expect(runTool).not.toHaveBeenCalled();
    expect(JSON.stringify(result.requests[1])).toContain("valid JSON object");
    expect(result.events[result.events.length - 1]).toMatchObject({ type: "done", reason: "blocked" });
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
