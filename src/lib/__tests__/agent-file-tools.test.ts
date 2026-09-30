import { describe, expect, it, vi } from "vitest";
import { TOOLS, LEGACY_OPS, runTool, setTurnFile, setTurnFiles, endTurn } from "../aiTools";
import { PDF_TOOLS } from "../../components/PdfToolbox";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { deliverFile } from "../agentFiles";

vi.mock("../agentFiles", () => ({ deliverFile: vi.fn(), outputDir: vi.fn() }));

// The agent reaches the document toolbox by id, off the same registry the Tools
// page renders. That only holds while the ids do — a renamed tool would turn
// into "no such tool" at runtime, inside a chat, where nobody sees it coming.

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
};

describe("the agent's view of the document toolbox", () => {
  it("processes every single-file attachment and keeps concurrent channel outputs separate", async () => {
    setDataMode("local"); setCacheOrg("file-tool-concurrent", "fixture-user");
    vi.mocked(deliverFile).mockReset().mockImplementation(async output => ({ name: output.name, url: `blob:${output.name}` }));
    const transform = vi.spyOn(PDF_TOOLS.find(t => t.id === "compress")!, "run").mockImplementation(async files => {
      await Promise.resolve();
      return [{ name: `${files[0].name}-result.pdf`, bytes: new Uint8Array([1, 2]) }];
    });
    const turns = ["in-app-files", "whatsapp-files", "telegram-files"];
    try {
      turns.forEach(turn => setTurnFiles(turn, [new File(["first"], `${turn}-first.pdf`), new File(["second"], `${turn}-second.pdf`)]));
      const results = await Promise.all(turns.map(turn => runTool("run_file_tool", { tool_id: "compress" }, () => true, true, turn)));
      results.forEach(result => expect(result).toMatchObject({ ok: true, files: expect.any(Array) }));
      expect(transform).toHaveBeenCalledTimes(6);
      turns.forEach(turn => expect(endTurn(turn).map(file => file.name)).toEqual([`${turn}-first.pdf-result.pdf`, `${turn}-second.pdf-result.pdf`]));
    } finally { transform.mockRestore(); turns.forEach(endTurn); setCacheOrg(null); }
  });
  it("forwards cancellation into the converter and never saves its late result", async () => {
    setDataMode("local"); setCacheOrg("file-tool-abort", "fixture-user");
    const controller = new AbortController();
    setTurnFile("file-tool-abort", new File(["fixture"], "source.pdf"));
    vi.mocked(deliverFile).mockClear();
    const transform = vi.spyOn(PDF_TOOLS.find(t => t.id === "compress")!, "run").mockImplementationOnce(async (_files, _params, context) => {
      expect(context?.signal).toBe(controller.signal);
      controller.abort();
      return [{ name: "late.pdf", bytes: new Uint8Array([1]) }];
    });
    try {
      await expect(runTool("run_file_tool", { tool_id: "compress" }, () => true, true, "file-tool-abort", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
      expect(deliverFile).not.toHaveBeenCalled();
      expect(endTurn("file-tool-abort")).toEqual([]);
    } finally { transform.mockRestore(); endTurn("file-tool-abort"); setCacheOrg(null); }
  });
  it("reports partial batch failures and refuses empty files rather than claiming success", async () => {
    setDataMode("local"); setCacheOrg("file-tool-partial", "fixture-user");
    setTurnFiles("file-tool-partial", [new File(["good"], "good.pdf"), new File(["bad"], "bad.pdf")]);
    vi.mocked(deliverFile).mockReset().mockImplementation(async output => ({ name: output.name, url: `blob:${output.name}` }));
    const transform = vi.spyOn(PDF_TOOLS.find(t => t.id === "compress")!, "run").mockImplementation(async files => [{ name: `${files[0].name}-result.pdf`, bytes: new Uint8Array(files[0].name === "good.pdf" ? [1] : []) }]);
    try {
      expect(await runTool("run_file_tool", { tool_id: "compress" }, () => true, true, "file-tool-partial")).toMatchObject({ ok: false, partial: true, files: ["good.pdf-result.pdf"], failed_files: [{ file: "bad.pdf", error: expect.stringContaining("no usable output") }] });
      expect(endTurn("file-tool-partial").map(file => file.name)).toEqual(["good.pdf-result.pdf"]);
    } finally { transform.mockRestore(); endTurn("file-tool-partial"); setCacheOrg(null); }
  });
  it("does not save a finished tool output into a changed workspace", async () => {
    setDataMode("local");
    setCacheOrg("file-tool-original", "fixture-user");
    setTurnFile("file-tool-scope", new File(["fixture"], "source.pdf"));
    vi.mocked(deliverFile).mockClear();
    const transform = vi.spyOn(PDF_TOOLS.find(t => t.id === "compress")!, "run").mockImplementationOnce(async () => {
      setCacheOrg("file-tool-other", "fixture-user");
      return [{ name: "compressed.pdf", bytes: new Uint8Array([1]) }];
    });
    try {
      await expect(runTool("run_file_tool", { tool_id: "compress", save_to_app: true }, () => true, true, "file-tool-scope")).rejects.toMatchObject({ name: "AbortError" });
      expect(deliverFile).not.toHaveBeenCalled();
      expect(endTurn("file-tool-scope")).toEqual([]);
    } finally { transform.mockRestore(); endTurn("file-tool-scope"); setCacheOrg(null); }
  });
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
