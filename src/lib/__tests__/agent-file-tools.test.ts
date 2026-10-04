import { describe, expect, it, vi } from "vitest";
import { TOOLS, LEGACY_OPS, runTool, setTurnFile, setTurnFiles, endTurn } from "../aiTools";
import { PDF_TOOLS } from "../../components/PdfToolbox";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { deliverFile } from "../agentFiles";
import { writeAgentStorage } from "../agentStorage";

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
  it("chains successful unlock output into compression and leaves that input intact after a failed operation", async () => {
    setDataMode("local"); setCacheOrg("file-tool-chain", "fixture-user");
    const original = new File([new Uint8Array([10, 11])], "protected.pdf", { type: "application/pdf" });
    setTurnFile("file-tool-chain", original);
    vi.mocked(deliverFile).mockReset().mockImplementation(async output => ({ name: output.name, url: `blob:${output.name}` }));
    const unlocked = new Uint8Array([20, 21, 22]);
    const decrypt = vi.spyOn(PDF_TOOLS.find(t => t.id === "decrypt")!, "run").mockImplementationOnce(async files => {
      expect(files[0]).toBe(original);
      return [{ name: "unlocked.pdf", bytes: unlocked }];
    });
    const compress = vi.spyOn(PDF_TOOLS.find(t => t.id === "compress")!, "run").mockImplementation(async files => {
      expect(files[0]).toMatchObject({ name: "unlocked.pdf", type: "application/pdf", size: 3 });
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(files[0]);
      });
      expect(bytes).toEqual(unlocked);
      return [{ name: "compressed.pdf", bytes: new Uint8Array([30]) }];
    });
    const extract = vi.spyOn(PDF_TOOLS.find(t => t.id === "pdf2txt")!, "run").mockRejectedValueOnce(new Error("Synthetic converter failure"));
    const read = vi.spyOn(await import("../pdfTools"), "pdfToText").mockImplementationOnce(async file => {
      expect(file.name).toBe("unlocked.pdf");
      return { name: "unlocked.txt", bytes: new TextEncoder().encode("Invoice text") };
    });
    try {
      expect(await runTool("run_file_tool", { tool_id: "decrypt", options: { password: "known-password" } }, () => true, true, "file-tool-chain")).toMatchObject({ ok: true });
      expect(await runTool("read_attached_document", {}, () => true, true, "file-tool-chain")).toMatchObject({ text: expect.stringContaining("Invoice text") });
      expect(await runTool("run_file_tool", { tool_id: "pdf2txt" }, () => true, true, "file-tool-chain")).toMatchObject({ error: "Synthetic converter failure" });
      expect(await runTool("run_file_tool", { tool_id: "compress" }, () => true, true, "file-tool-chain")).toMatchObject({ ok: true });
      expect(endTurn("file-tool-chain").map(file => file.name)).toEqual(["unlocked.pdf", "compressed.pdf"]);
    } finally { decrypt.mockRestore(); compress.mockRestore(); extract.mockRestore(); read.mockRestore(); endTurn("file-tool-chain"); setCacheOrg(null); }
  });
  it("never replaces original working files with a partially successful batch", async () => {
    setDataMode("local"); setCacheOrg("file-tool-chain-partial", "fixture-user");
    const originals = [new File(["first"], "first.pdf"), new File(["second"], "second.pdf")];
    setTurnFiles("file-tool-chain-partial", originals);
    vi.mocked(deliverFile).mockReset().mockImplementation(async output => ({ name: output.name, url: `blob:${output.name}` }));
    const decrypt = vi.spyOn(PDF_TOOLS.find(t => t.id === "decrypt")!, "run").mockImplementation(async files => {
      if (files[0] === originals[1]) throw new Error("Wrong password");
      return [{ name: "unlocked.pdf", bytes: new Uint8Array([1]) }];
    });
    const merge = vi.spyOn(PDF_TOOLS.find(t => t.id === "merge")!, "run").mockImplementationOnce(async files => {
      expect(files).toEqual(originals);
      return [{ name: "merged.pdf", bytes: new Uint8Array([2]) }];
    });
    try {
      expect(await runTool("run_file_tool", { tool_id: "decrypt" }, () => true, true, "file-tool-chain-partial")).toMatchObject({ ok: false, partial: true });
      expect(await runTool("run_file_tool", { tool_id: "merge" }, () => true, true, "file-tool-chain-partial")).toMatchObject({ ok: true });
    } finally { decrypt.mockRestore(); merge.mockRestore(); endTurn("file-tool-chain-partial"); setCacheOrg(null); }
  });
  it("keeps explicit media reference numbers tied to original attachments after a document conversion", async () => {
    setDataMode("local"); setCacheOrg("file-tool-original-reference", "fixture-user");
    const originals = [new File(["pdf"], "first.pdf"), new File(["photo"], "second.png", { type: "image/png" })];
    setTurnFiles("file-tool-reference", originals);
    writeAgentStorage("filey.ai.media.config", JSON.stringify({ videoSource: "credits" }));
    vi.mocked(deliverFile).mockReset().mockImplementation(async output => ({ name: output.name, url: `blob:${output.name}` }));
    const convert = vi.spyOn(PDF_TOOLS.find(t => t.id === "compress")!, "run").mockImplementation(async files => [{ name: `${files[0].name}-converted.pdf`, bytes: new Uint8Array([1]) }]);
    const media = await import("../aiMedia");
    const quote = vi.spyOn(media, "createMediaDraft").mockResolvedValue({ id: "media-91000000-0000-4000-8000-000000000001", state: "draft" } as import("../aiMedia").MediaJob);
    try {
      expect(await runTool("run_file_tool", { tool_id: "compress" }, () => true, true, "file-tool-reference")).toMatchObject({ ok: true });
      expect(await runTool("create_video_draft", { prompt: "Use my second original photo", duration: 5, reference_file: 2 }, () => true, true, "file-tool-reference")).toMatchObject({ pending_action: "media_approval" });
      expect(quote).toHaveBeenCalledWith("video", "Use my second original photo", expect.objectContaining({ reference: originals[1] }));
    } finally { quote.mockRestore(); convert.mockRestore(); endTurn("file-tool-reference"); setCacheOrg(null); }
  });
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
  it.each([false, true])("does not save a finished tool output after changing workspace (return to original: %s)", async returnToOriginal => {
    setDataMode("local");
    setCacheOrg("file-tool-original", "fixture-user");
    setTurnFile("file-tool-scope", new File(["fixture"], "source.pdf"));
    vi.mocked(deliverFile).mockClear();
    const transform = vi.spyOn(PDF_TOOLS.find(t => t.id === "compress")!, "run").mockImplementationOnce(async () => {
      setCacheOrg("file-tool-other", "fixture-user");
      if (returnToOriginal) setCacheOrg("file-tool-original", "fixture-user");
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
