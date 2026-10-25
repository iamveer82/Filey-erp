import { beforeEach, expect, it, vi } from "vitest";

// Filey as an MCP server: outside agents get two tools, run actions through the app's own
// runTool as a non-owner, and sensitive actions always ask the owner in Filey.
const tools = vi.hoisted(() => ({ runTool: vi.fn(), confirmInApp: vi.fn(), endTurn: vi.fn(() => []) }));
vi.mock("../aiTools", () => tools);
vi.mock("../fileyAgent", () => ({ fileyToolCatalog: (name?: string, query?: string) => ({ name, query }) }));
vi.mock("../alwaysOn", () => ({ notifyOwner: vi.fn() }));

beforeEach(() => { tools.runTool.mockReset(); tools.confirmInApp.mockReset(); });

it("lists the two Filey tools", async () => {
  const { mcpResponse } = await import("../fileyMcp");
  const res = await mcpResponse("tools/list", {}) as { result: { tools: { name: string }[] } };
  expect(res.result.tools.map(t => t.name)).toEqual(["filey_tools", "filey_run"]);
});

it("runs an action as a non-owner, always asking the owner for sensitive steps", async () => {
  const { mcpResponse } = await import("../fileyMcp");
  tools.runTool.mockImplementation(async (_name, _args, confirm) => ({ ok: await confirm("send_whatsapp", { to: "+971" }) }));
  tools.confirmInApp.mockResolvedValue(true);
  const res = await mcpResponse("tools/call", { name: "filey_run", arguments: { name: "send_whatsapp", args: '{"to":"+971"}' } });
  expect(tools.runTool).toHaveBeenCalledWith("send_whatsapp", { to: "+971" }, expect.any(Function), false, expect.stringMatching(/^mcp-/), undefined, undefined, "mcp");
  expect(tools.confirmInApp).toHaveBeenCalledWith("send_whatsapp", { to: "+971" });
  expect(res).toEqual({ result: { content: [{ type: "text", text: '{"ok":true}' }], isError: false } });
});

it("marks a refused action as an error result and rejects unknown tools", async () => {
  const { mcpResponse } = await import("../fileyMcp");
  tools.runTool.mockResolvedValue({ error: "Cancelled — the user did not approve this action." });
  expect(await mcpResponse("tools/call", { name: "filey_run", arguments: { name: "record_invoice_payment", args: {} } }))
    .toMatchObject({ result: { isError: true } });
  expect(await mcpResponse("tools/call", { name: "rm_rf", arguments: {} })).toMatchObject({ result: { isError: true } });
});
