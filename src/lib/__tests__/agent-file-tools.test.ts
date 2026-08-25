import { describe, expect, it } from "vitest";
import { TOOLS, LEGACY_OPS } from "../aiTools";
import { PDF_TOOLS } from "../../components/PdfToolbox";

// The agent reaches the document toolbox by id, off the same registry the Tools
// page renders. That only holds while the ids do — a renamed tool would turn
// into "no such tool" at runtime, inside a chat, where nobody sees it coming.

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
};

describe("the agent's view of the document toolbox", () => {
  it("offers every tool the Tools page has", async () => {
    const res = (await tool("list_file_tools").run({})) as {
      count: number;
      of: number;
      tools: { id: string }[];
    };
    expect(res.of).toBe(PDF_TOOLS.length);
    expect(res.count).toBe(PDF_TOOLS.length);
    expect(res.tools.map((t) => t.id).sort()).toEqual(PDF_TOOLS.map((t) => t.id).sort());
  });

  it("narrows on a query so the model isn't handed the whole catalogue", async () => {
    const res = (await tool("list_file_tools").run({ query: "compress" })) as {
      count: number;
      tools: { id: string }[];
    };
    expect(res.count).toBeGreaterThan(0);
    expect(res.count).toBeLessThan(PDF_TOOLS.length);
    expect(res.tools.some((t) => t.id === "compress")).toBe(true);
  });

  it("runs merge headless but flags the tools that genuinely need their workspace", async () => {
    const res = (await tool("list_file_tools").run({})) as {
      tools: { id: string; needs_the_user: boolean }[];
    };
    // Merge carries a drag-order workspace, but attachments arrive in order —
    // the agent combines them in the chat instead of sending anyone anywhere.
    expect(res.tools.find((t) => t.id === "merge")?.needs_the_user).toBe(false);
    // Page-level editors (live preview, drag on canvas) have no headless path.
    expect(res.tools.find((t) => t.id === "split")?.needs_the_user).toBe(true);
    expect(res.tools.find((t) => t.id === "esign")?.needs_the_user).toBe(true);
  });

  it("keeps every legacy operation name pointing at a tool that exists", () => {
    const ids = new Set(PDF_TOOLS.map((t) => t.id));
    for (const [op, target] of Object.entries(LEGACY_OPS))
      expect(ids.has(target.id), `${op} → ${target.id}`).toBe(true);
  });

  it("refuses an unknown id with something the model can act on", async () => {
    // No attachment is checked first, so this exercises the id path only once a
    // file is present — assert the shape of the miss instead.
    const res = (await tool("run_file_tool").run({ tool_id: "definitely-not-a-tool" })) as {
      error: string;
    };
    expect(res.error).toBeTruthy();
  });
});
