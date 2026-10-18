import { expect, it, vi } from "vitest";

// A Word save is written where the user chose and kept in My Files under the
// chosen name, replacing that name's earlier Word copy (local and cloud alike).
const state = vi.hoisted(() => ({ saved: [] as { name: string; tool?: string }[], deleted: [] as string[], written: [] as string[] }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: async () => "C:\\Docs\\Plan.docx" }));
vi.mock("../localPaths", () => ({ writeDocFile: async (dir: string, name: string) => { state.written.push(`${dir}|${name}`); return `${dir}\\${name}`; } }));
vi.mock("../realtime", () => ({ notifyDataChanged: vi.fn() }));
vi.mock("../files", () => ({
  canSaveFiles: async () => true,
  listFiles: async () => [
    { id: "old-word", name: "Plan.docx", tool: "word" },
    { id: "invoice", name: "Plan.docx", tool: "invoice" },
    { id: "other-word", name: "Memo.docx", tool: "word" },
  ],
  saveOutput: async (out: { name: string }, tool?: string) => { state.saved.push({ name: out.name, tool }); return "new"; },
  deleteFile: async (f: { id: string }) => { state.deleted.push(f.id); },
}));

import { bridgeDesktop, captureNextSave, officeAppFor, registerOfficeFrame } from "../officeWord";

if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = function () {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(this);
  });
};

type Picker = (o: { suggestedName: string }) => Promise<{ createWritable: () => Promise<{ write: (c: BlobPart) => Promise<void>; close: () => Promise<void> }> }>;

it("keeps each Word save in My Files, replacing only the same-name Word copy", async () => {
  const win = { Promise } as unknown as Window & { showSaveFilePicker: Picker };
  bridgeDesktop(win);
  const writable = await (await win.showSaveFilePicker({ suggestedName: "Draft.docx" })).createWritable();
  await writable.write(new Uint8Array([80, 75]));
  await writable.close();
  expect(state.written).toEqual(["C:\\Docs|Plan.docx"]);
  await vi.waitFor(() => expect(state.deleted).toEqual(["old-word"]));
  expect(state.saved).toEqual([{ name: "Plan.docx", tool: "word" }]);
});

it("keeps a PDF save in My Files, or hands it to the agent that asked for it", async () => {
  // In a test the page is its own frame: the PDF app's messages come from `window`.
  const off = registerOfficeFrame("pdf", "pdf-1", window);
  const save = (name: string) => window.dispatchEvent(new MessageEvent("message", {
    data: { type: "pdfcraft:save", name, saveAs: false, bytes: new Uint8Array([37, 80]).buffer }, origin: location.origin, source: window,
  }));
  state.saved.length = 0;
  save("Signed.pdf");
  await vi.waitFor(() => expect(state.saved).toEqual([{ name: "Signed.pdf", tool: "pdf" }]));
  const capture = captureNextSave(window);
  save("Agent.pdf");
  expect((await capture.file).name).toBe("Agent.pdf");
  expect(state.saved).toEqual([{ name: "Signed.pdf", tool: "pdf" }]);
  off();
});

it("knows which Office app opens a file", () => {
  expect(["Plan.docx", "Budget.XLSX", "stock.csv", "Contract.pdf", "photo.png"].map(officeAppFor)).toEqual(["word", "sheet", "sheet", "pdf", undefined]);
});

it("catches a Slides/Designs/Fig/Vector download for the agent instead of losing it in the webview", async () => {
  const clicked: string[] = [];
  class Anchor { download = ""; href = ""; click() { clicked.push(this.href); } }
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const win = { Promise, HTMLAnchorElement: Anchor, fetch: async () => ({ arrayBuffer: async () => bytes.buffer }) } as unknown as Window;
  bridgeDesktop(win, "slides");
  const capture = captureNextSave(win);
  const link = Object.assign(new Anchor(), { download: "Pitch.pdf", href: "blob:http://tauri.localhost/1" });
  link.click();
  await expect(capture.file).resolves.toEqual({ name: "Pitch.pdf", bytes });
  // Ordinary links still behave as links.
  Object.assign(new Anchor(), { href: "https://getartcraft.com" }).click();
  expect(clicked).toEqual(["https://getartcraft.com"]);
});

it("opens each Office file type in its app", () => {
  expect(["Deck.pptx", "Brochure.idml", "App.fig", "Logo.svg", "Book.xlsx"].map(officeAppFor)).toEqual(["slides", "design", "fig", "vector", "sheet"]);
});
