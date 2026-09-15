import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useImperativeHandle } from "react";
import { Link, MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { AuthProvider } from "../../lib/auth";
import { toolRuns, setCacheOrg } from "../../lib/api";
import PdfTools from "../PdfTools";

const boundary = vi.hoisted(() => ({ run: vi.fn(), download: vi.fn(), prepare: vi.fn(), edit: vi.fn() }));
vi.mock("../../lib/pdfTools", async (original) => ({ ...await original<typeof import("../../lib/pdfTools")>(), downloadFile: boundary.download }));
vi.mock("../../components/MergeStudio", () => ({ default: ({ onApply }: { onApply: (out: unknown) => void }) => <button onClick={() => boundary.edit(onApply)}>Process in editor</button> }));
vi.mock("../../components/InlinePdfEditor", () => ({ default: function MockPdfEditor({ editorRef }: { editorRef: import("react").Ref<unknown> }) { useImperativeHandle(editorRef, () => ({ prepare: boundary.prepare })); return <div>Document editor</div>; } }));
vi.mock("../../components/PdfToolbox", () => {
  const tools = ["alpha", "beta", "gamma"].map(id => ({ id, name: id === "alpha" ? "Alpha tool" : id === "beta" ? "Beta tool" : "Gamma tool", interactive: id === "gamma" ? "merge" : undefined, cat: "Convert", desc: "Test local conversion", icon: () => null, accept: ".bin,.pdf", multi: id === "beta", run: boundary.run }));
  return { PDF_TOOLS: tools, toolById: (id: string) => tools.find(t => t.id === id), toolFlow: () => ({ from: "BIN", to: "PDF" }), defaultParams: () => ({ suffix: "default" }), ToolFields: ({ params, setParams }: { params: Record<string, string>; setParams: (next: Record<string, string>) => void }) => <input aria-label="Output suffix" value={params.suffix} onChange={e => setParams({ suffix: e.target.value })} /> };
});

// ── Mock the data boundary: a chainable, awaitable stub that always yields
// {data:[], error:null}. Covers pages that call sb() directly and via lib/api. ──
vi.mock("../../lib/supabase", () => {
  const result = { data: [], error: null, count: 0 };
  const makeQuery = (): unknown => {
    const proxy: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => res(result);
        return () => proxy; // every builder method is chainable
      },
      apply: () => proxy,
    });
    return proxy;
  };
  const sb = () => ({
    from: makeQuery,
    rpc: makeQuery,
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  });
  return { sb, supabase: null, isConfigured: true, cloudConfigured: false };
});

// Force local mode so anything reading the data mode behaves deterministically.
vi.mock("../../lib/dataMode", () => ({
  isLocalMode: () => true,
  getDataMode: () => "local",
  setDataMode: () => {},
  assertWorkspaceCurrent: () => {},
}));

// Tauri isn't present in jsdom — make invoke a no-op resolve.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

beforeEach(() => {
  setCacheOrg("tool-test", "tester");
  localStorage.clear();
  boundary.prepare.mockReset().mockResolvedValue(undefined);
  boundary.run.mockReset().mockResolvedValue([{ name: "output.pdf", bytes: new Uint8Array([1]) }]);
  boundary.download.mockReset().mockResolvedValue(false);
  vi.spyOn(toolRuns, "log").mockResolvedValue(0);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(route = "/tools?tool=alpha") {
  return render(<MemoryRouter initialEntries={[route]}><AuthProvider><UIProvider><Link to="/tools?tool=beta">Switch tool</Link><PdfTools /></UIProvider></AuthProvider></MemoryRouter>);
}
function upload(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["source"], "source.bin", { type: "application/octet-stream" })] } });
}

it("keeps generated output after cancellation and retries the download without rerunning the tool", async () => {
  const view = setup();
  upload(view.container);
  fireEvent.click(view.getByRole("button", { name: "Alpha tool" }));
  await view.findByRole("region", { name: "Your results" });
  expect(boundary.download).not.toHaveBeenCalled();
  expect(toolRuns.log).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Download results" }));
  expect(await view.findByText(/Save canceled/)).toBeTruthy();
  expect(boundary.run).toHaveBeenCalledOnce();
  boundary.download.mockResolvedValue(true);
  fireEvent.click(view.getByRole("button", { name: "Download results" }));
  expect(await view.findByText("Downloaded 1 file.")).toBeTruthy();
  expect(boundary.run).toHaveBeenCalledOnce();
  expect(boundary.download).toHaveBeenCalledTimes(2);
  expect(toolRuns.log).not.toHaveBeenCalled();
});

it("accepts dropped files, rejects the wrong format and keeps the uploaded file after a failure", async () => {
  const view = setup();
  fireEvent.drop(view.container.querySelector(".tool-dropzone")!, { dataTransfer: { files: [new File(["bad"], "wrong.txt", { type: "text/plain" })] } });
  expect(view.getByRole("alert")).toHaveTextContent("wrong.txt is not supported");
  expect(boundary.run).not.toHaveBeenCalled();
  fireEvent.drop(view.container.querySelector(".tool-dropzone")!, { dataTransfer: { files: [new File(["source"], "source.bin")] } });
  expect(view.queryByRole("alert")).toBeNull();
  boundary.run.mockRejectedValueOnce(new Error("Cannot read this file"));
  fireEvent.click(view.getByRole("button", { name: "Alpha tool" }));
  expect(await view.findByRole("alert")).toHaveTextContent("Cannot read this file");
  expect(view.getByRole("button", { name: "Remove source.bin" })).toBeEnabled();
  fireEvent.click(view.getByRole("button", { name: "Alpha tool" }));
  expect(await view.findByRole("region", { name: "Your results" })).toHaveTextContent("output.pdf");
  expect(view.queryByRole("alert")).toBeNull();
});

it("adds and reorders multiple files before processing and removes a file without changing the others", async () => {
  const view = setup("/tools?tool=beta");
  const first = new File(["first"], "first.bin");
  const second = new File(["second"], "second.bin");
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [first] } });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [second] } });
  fireEvent.click(view.getByRole("button", { name: "Move second.bin up" }));
  fireEvent.click(view.getByRole("button", { name: "Beta tool" }));
  await waitFor(() => expect(boundary.run).toHaveBeenCalledWith([second, first], { suffix: "default" }, expect.objectContaining({signal:expect.any(AbortSignal),onProgress:expect.any(Function)})));
  await view.findByRole("region", { name: "Your results" });
  fireEvent.click(view.getByRole("button", { name: "Adjust again" }));
  fireEvent.click(view.getByRole("button", { name: "Remove first.bin" }));
  expect(view.queryByRole("button", { name: "Download results" })).toBeNull();
  expect(view.getByRole("button", { name: "Remove second.bin" })).toBeEnabled();
});

it("finds tools from the illustrated catalogue and recovers an empty search", async () => {
  const view = setup("/tools");
  expect(view.getByRole("button", { name: "Open Alpha tool" }).querySelector("img")).toHaveAttribute("src", "/tool-covers/tools/alpha.webp");
  fireEvent.change(view.getByRole("textbox", { name: "Search tools by name or what they do…" }), { target: { value: "Beta" } });
  expect(view.queryByRole("button", { name: "Open Alpha tool" })).toBeNull();
  expect(view.getByRole("button", { name: "Open Beta tool" })).toBeEnabled();
  fireEvent.change(view.getByRole("textbox", { name: "Search tools by name or what they do…" }), { target: { value: "not found" } });
  fireEvent.click(view.getByRole("button", { name: "Clear filters" }));
  fireEvent.click(view.getByRole("button", { name: "Open Alpha tool" }));
  expect(view.getByRole("heading", { name: "Alpha tool", level: 1 })).toBeTruthy();
});

it("clears old output when options change and resets files and options on direct tool navigation", async () => {
  const view = setup();
  upload(view.container);
  fireEvent.click(view.getByRole("button", { name: "Alpha tool" }));
  await view.findByRole("region", { name: "Your results" });
  fireEvent.click(view.getByRole("button", { name: "Adjust again" }));
  fireEvent.change(view.getByRole("textbox", { name: "Output suffix" }), { target: { value: "revised" } });
  expect(view.queryByRole("button", { name: "Download results" })).toBeNull();
  fireEvent.click(view.getByRole("link", { name: "Switch tool" }));
  await view.findByRole("heading", { name: "Beta tool", level: 1 });
  expect(view.queryByRole("button", { name: "Beta tool" })).toBeNull();
  upload(view.container);
  expect(view.getByRole("textbox", { name: "Output suffix" })).toHaveValue("default");
  fireEvent.click(view.getByRole("button", { name: "Beta tool" }));
  await waitFor(() => expect(boundary.run).toHaveBeenCalledTimes(2));
  expect(boundary.run.mock.calls[1][1]).toEqual({ suffix: "default" });
});


it("includes pending canvas edits in the primary action and stops if preparing edits fails", async () => {
  const view = setup();
  const original = new File(["source"], "source.pdf", { type: "application/pdf" });
  const edited = new File(["with brush strokes"], "edited.pdf", { type: "application/pdf" });
  boundary.prepare.mockRejectedValueOnce(new Error("Could not save edits")).mockResolvedValueOnce(edited);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [original] } });
  fireEvent.click(view.getByRole("button", { name: "Alpha tool" }));
  expect(await view.findByRole("alert")).toHaveTextContent("Could not save edits");
  expect(boundary.run).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Alpha tool" }));
  await waitFor(() => expect(boundary.run).toHaveBeenCalledWith([edited], { suffix: "default" }, expect.objectContaining({signal:expect.any(AbortSignal),onProgress:expect.any(Function)})));
});

it("passes output bytes to the next compatible tool without reuploading or cloud writes", async () => {
  const view = setup();
  upload(view.container);
  fireEvent.click(view.getByRole("button", { name: "Alpha tool" }));
  await view.findByRole("region", { name: "Your results" });
  fireEvent.change(view.getByRole("combobox", { name: "Next tool" }), { target: { value: "beta" } });
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  expect(await view.findByRole("button", { name: "Remove output.pdf" })).toBeEnabled();
  fireEvent.click(view.getByRole("button", { name: "Beta tool" }));
  await waitFor(() => expect(boundary.run).toHaveBeenCalledTimes(2));
  expect(boundary.run.mock.calls[1][0][0].name).toBe("output.pdf");
  expect(boundary.run.mock.calls[1][0][0].type).toBe("application/pdf");
  expect(toolRuns.log).not.toHaveBeenCalled();
  expect(boundary.download).not.toHaveBeenCalled();
});

it("persists favourite shortcuts and restores search when returning from a tool", async () => {
  const view = setup("/tools");
  fireEvent.click(view.getByRole("button", { name: "Add Alpha tool to favourites" }));
  fireEvent.click(view.getByRole("button", { name: /Favourites/ }));
  expect(view.getByRole("button", { name: "Open Alpha tool" })).toBeEnabled();
  expect(view.queryByRole("button", { name: "Open Beta tool" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Open Alpha tool" }));
  fireEvent.click(view.getByRole("button", { name: "All tools" }));
  expect(view.getByRole("button", { name: /Favourites/ })).toHaveAttribute("aria-pressed", "true");
  expect(view.getByRole("button", { name: "Remove Alpha tool from favourites" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(view.getByRole("button", { name: "All tools" }));
  fireEvent.change(view.getByRole("textbox", { name: "Search tools by name or what they do…" }), { target: { value: "Beta" } });
  fireEvent.click(view.getByRole("button", { name: "Open Beta tool" }));
  fireEvent.click(view.getByRole("button", { name: "All tools" }));
  expect(view.getByRole("textbox", { name: "Search tools by name or what they do…" })).toHaveValue("Beta");
});

it("clears output on workspace change and rejects a late conversion result", async () => {
  let resolve!: (output: { name: string; bytes: Uint8Array }[]) => void;
  boundary.run.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = setup();
  upload(view.container);
  fireEvent.click(view.getByRole("button", { name: "Alpha tool" }));
  await waitFor(() => expect(boundary.run).toHaveBeenCalledOnce());
  setCacheOrg("other", "tester");
  await waitFor(() => expect(view.queryByRole("button", { name: "Remove source.bin" })).toBeNull());
  resolve([{ name: "old-account.pdf", bytes: new Uint8Array([2]) }]);
  await waitFor(() => expect(view.queryByRole("region", { name: "Your results" })).toBeNull());
  expect(boundary.download).not.toHaveBeenCalled();
});

it("ignores an editor result from a file that has been replaced", async () => {
  const view = setup("/tools?tool=gamma");
  upload(view.container);
  fireEvent.click(view.getByRole("button", { name: "Process in editor" }));
  const finishOldFile = boundary.edit.mock.calls[boundary.edit.mock.calls.length - 1][0];
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["new"], "replacement.bin")] } });
  await finishOldFile({ name: "stale.pdf", bytes: new Uint8Array([1]) });
  expect(view.queryByRole("region", { name: "Your results" })).toBeNull();
  expect(boundary.download).not.toHaveBeenCalled();
});
