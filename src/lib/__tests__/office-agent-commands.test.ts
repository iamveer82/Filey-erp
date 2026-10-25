// The office apps are driven by command ids that live in the Craft apps, not
// in this repo: "file.new", "file.saveBytes", "document.export", "app.print".
// The patch forwards whatever id it is given, and a wrong id comes back as
// {ok:false} — which used to reach the user as "could not save the file" with
// nothing in the repo to catch it. No test drove these paths at all.
//
// So the ids are pinned here, per app and per format, together with the field
// the reply must carry. Change an id in aiTools.ts and this fails; change an
// id in the app and this is the place that notices first.
import { describe, expect, it, vi, beforeEach } from "vitest";

const calls = vi.hoisted(() => [] as { method: string; params: unknown }[]);
const kept = vi.hoisted(() => [] as { name: string; app: string }[]);

vi.mock("../officeWord", () => ({
  officeWindow: async () => ({}) as Window,
  officeControl: async (_win: Window, method: string, params: unknown) => {
    calls.push({ method, params });
    // Every save replies with its payload under the field the tool expects.
    return { ok: true, result: { base64: btoa("x"), data: btoa("x"), dataBase64: btoa("x"), text: "x", png: btoa("x") } };
  },
  captureNextSave: () => ({ cancel: () => {}, file: Promise.resolve({ name: "x", bytes: new Uint8Array([1]) }) }),
  openInOffice: async () => {},
  keepInMyFiles: async (name: string, _bytes: Uint8Array, app: string) => { kept.push({ name, app }); },
}));
vi.mock("../agentFiles", () => ({
  deliverFile: async (f: { name: string }) => ({ name: f.name, path: "C:\\out" }),
}));
const settings = vi.hoisted(() => [] as { key: string; value: string }[]);
vi.mock(import("../api"), async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    tools: {
      ...actual.tools,
      settings: async () => [...settings],
      setSetting: async () => {},
    },
  };
});

import { TOOLS } from "../aiTools";

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
};

beforeEach(() => {
  calls.length = 0;
  kept.length = 0;
  // The office apps run in the desktop app; the tool refuses otherwise.
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
});

describe("the office apps answer the commands the agent sends", () => {
  it("starts a blank file in each app that can have one", async () => {
    for (const [app, command] of [
      ["word", "file.new"],
      ["sheet", "file.new"],
      ["slides", "file.new"],
      ["design", "file.new"],
      ["fig", "file.new"],
      ["vector", "file.new"],
    ] as const) {
      calls.length = 0;
      const res = (await tool(app).run({ action: "new" })) as { ok?: boolean; error?: string };
      expect(res.error, `${app} new: ${res.error}`).toBeUndefined();
      expect(res.ok).toBe(true);
      const fresh = calls.find((c) => (c.params as { command?: string })?.command === command);
      expect(fresh, `${app} must start a blank file with ${command}`).toBeTruthy();
      expect(fresh?.method).toBe("engine.execute");
    }
  });

  it("saves each format with the command that app uses", async () => {
    const cases: [string, string, { method: string; command?: string; format?: string; id?: string }][] = [
      ["word", "Report.docx", { method: "engine.execute", command: "file.saveAs" }],
      ["word", "Report.pdf", { method: "engine.execute", command: "file.exportPdf" }],
      ["sheet", "Book.xlsx", { method: "engine.execute", command: "file.saveBytes", format: "xlsx" }],
      ["sheet", "Book.csv", { method: "engine.execute", command: "file.saveBytes", format: "csv" }],
      ["slides", "Deck.pptx", { method: "engine.execute", command: "file.saveBytes", format: "pptx" }],
      ["slides", "Deck.png", { method: "engine.execute", command: "file.render" }],
      ["design", "Brochure.pdf", { method: "engine.execute", command: "file.exportPdf" }],
      ["design", "Brochure.idml", { method: "engine.execute", command: "file.exportIdml" }],
      ["design", "Brochure.html", { method: "engine.execute", command: "file.exportHtml" }],
      ["fig", "App.figcraft", { method: "ui.menu.invoke", id: "file.save" }],
      ["fig", "App.png", { method: "engine.execute", command: "file.export", format: "png" }],
      ["vector", "Logo.svg", { method: "engine.execute", command: "document.export", format: "svg" }],
      ["pdf", "Signed.pdf", { method: "ui.command", id: "file.save" }],
    ];
    for (const [app, name, expected] of cases) {
      calls.length = 0;
      const res = (await tool(app).run({ action: "save", name })) as { ok?: boolean; error?: string; file?: string };
      expect(res.error, `${app} save ${name}: ${res.error}`).toBeUndefined();
      expect(res.ok, `${app} save ${name}`).toBe(true);
      expect(res.file).toBe(name);
      const call = calls.find((c) => c.method === expected.method);
      expect(call, `${app} save ${name} must call ${expected.method}`).toBeTruthy();
      const params = (call?.params ?? {}) as Record<string, unknown>;
      if (expected.command) expect(params.command, `${app} ${name}`).toBe(expected.command);
      if (expected.format) expect(params.format ?? (params.params as Record<string, unknown>)?.format, `${app} ${name}`).toBe(expected.format);
      if (expected.id) expect(params.id, `${app} ${name}`).toBe(expected.id);
      expect(kept.map((k) => k.name)).toContain(name);
    }
  });

  it("refuses a name the app cannot write", async () => {
    const res = (await tool("word").run({ action: "save", name: "Report" })) as { error?: string };
    expect(res.error ?? "").toMatch(/ending in/i);
  });

  it("puts the letterhead image at the top of the Word tab, never in another program", async () => {
    settings.length = 0;
    settings.push({ key: "company_letterhead", value: JSON.stringify({ background: "data:image/png;base64," + btoa("png") }) });
    const res = (await tool("word").run({ action: "insert_letterhead", query: "dune letterhead" })) as { ok?: boolean; letterhead?: string };
    expect(res.ok).toBe(true);
    expect(res.letterhead).toBe("letterhead.png");
    const commands = calls.map((c) => (c.params as { command?: string }).command);
    expect(commands).toEqual(["select.all", "select.collapse", "insert.picture"]);
  });

  it("runs a request and reports which step failed", async () => {
    const res = (await tool("word").run({
      action: "run",
      requests: [{ method: "engine.execute", params: { command: "text.insert" } }],
    })) as { ok?: boolean; results?: unknown[] };
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.results)).toBe(true);
    expect(calls.some((c) => c.method === "engine.execute")).toBe(true);
  });
});
