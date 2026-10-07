import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import ESignStudio from "../ESignStudio";
import { UIProvider } from "../../lib/ui";

const engine = vi.hoisted(() => ({ normalize: vi.fn() }));
vi.mock("../../lib/pdfTools", () => ({ ensurePdf: engine.normalize, placeStamp: vi.fn(), downloadFile: vi.fn() }));
vi.mock("../../lib/pdfjsSafe", () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }), render: () => ({ promise: Promise.resolve() }) }) }) }) }));

class PendingReader {
  static reads: PendingReader[] = [];
  result = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  abort = vi.fn();
  readAsDataURL() { PendingReader.reads.push(this); }
  finish(result: string) { this.result = result; this.onload?.(); }
}

beforeEach(() => {
  PendingReader.reads = [];
  vi.stubGlobal("FileReader", PendingReader);
  engine.normalize.mockReset().mockImplementation(async (file: File) => file);
  const context = { drawImage() {}, strokeRect() {}, setLineDash() {}, clearRect() {} };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AQID");
  vi.stubGlobal("Image", class {
    naturalWidth = 600;
    naturalHeight = 200;
    onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixtureDocument() {
  const file = new File(["synthetic PDF"], "fixture.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  return file;
}

function openUploadMode(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole("button", { name: /Use a signature image/ }));
  fireEvent.change(view.container.querySelector('input[accept^="application/pdf"]')!, { target: { files: [fixtureDocument()] } });
}

async function signatureInput(view: ReturnType<typeof render>) {
  await view.findByText("fixture.pdf");
  return view.container.querySelector('input[accept^="image/png"]')!;
}

it("keeps the most recent signature when an earlier image finishes later", async () => {
  const view = render(<UIProvider><ESignStudio /></UIProvider>);
  openUploadMode(view);
  const input = await signatureInput(view);
  fireEvent.change(input, { target: { files: [new File(["old"], "old.png")] } });
  const old = PendingReader.reads[0];
  const queuedOldCallback = old.onload!;
  fireEvent.change(input, { target: { files: [new File(["new"], "new.png")] } });
  act(() => PendingReader.reads[1].finish("data:image/png;base64,TkVX"));
  act(() => { old.result = "data:image/png;base64,T0xE"; queuedOldCallback(); });
  expect(view.getByRole("img", { name: "Signature" })).toHaveAttribute("src", "data:image/png;base64,TkVX");
  expect(old.abort).toHaveBeenCalledOnce();
});

it("does not restore a pending signature after changing modes", async () => {
  const view = render(<UIProvider><ESignStudio /></UIProvider>);
  openUploadMode(view);
  fireEvent.change(await signatureInput(view), { target: { files: [new File(["old"], "old.png")] } });
  const old = PendingReader.reads[0];
  const queuedOldCallback = old.onload!;
  fireEvent.click(view.getByRole("button", { name: /Make a Sign/ }));
  openUploadMode(view);
  await signatureInput(view);
  act(() => { old.result = "data:image/png;base64,T0xE"; queuedOldCallback(); });
  expect(view.queryByRole("img", { name: "Signature" })).not.toBeInTheDocument();
  expect(old.abort).toHaveBeenCalledOnce();
});

it("aborts pending signature reads when the studio closes", async () => {
  const view = render(<UIProvider><ESignStudio /></UIProvider>);
  openUploadMode(view);
  fireEvent.change(await signatureInput(view), { target: { files: [new File(["old"], "old.png")] } });
  const old = PendingReader.reads[0];
  view.unmount();
  expect(old.abort).toHaveBeenCalledOnce();
});

it("does not restore an old document into a new mode after its conversion finishes", async () => {
  let complete!: (file: File) => void;
  engine.normalize.mockImplementationOnce(() => new Promise<File>((resolve) => { complete = resolve; }));
  const view = render(<UIProvider><ESignStudio /></UIProvider>);
  openUploadMode(view);
  fireEvent.click(view.getByRole("button", { name: /Draw on a document/ }));
  await act(async () => complete(fixtureDocument()));
  await waitFor(() => expect(view.queryByText("fixture.pdf")).not.toBeInTheDocument());
  expect(view.getByText("Upload Document")).toBeInTheDocument();
});
