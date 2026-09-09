import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { AuthProvider } from "../../lib/auth";
import { toolRuns } from "../../lib/api";
import PdfTools from "../PdfTools";

const boundary = vi.hoisted(() => ({ run: vi.fn(), download: vi.fn() }));
vi.mock("../../lib/pdfTools", async (original) => ({ ...await original<typeof import("../../lib/pdfTools")>(), downloadFile: boundary.download }));
vi.mock("../../components/PdfToolbox", () => {
  const tools = ["alpha", "beta"].map(id => ({ id, name: id === "alpha" ? "Alpha tool" : "Beta tool", cat: "Convert", desc: "Test local conversion", icon: () => null, accept: ".bin", multi: id === "beta", run: boundary.run }));
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
  fireEvent.click(view.getByRole("button", { name: "Run Alpha tool" }));
  expect(await view.findByText(/Save canceled/)).toBeTruthy();
  expect(boundary.run).toHaveBeenCalledOnce();
  boundary.download.mockResolvedValue(true);
  fireEvent.click(view.getByRole("button", { name: "Download results" }));
  expect(await view.findByText("Downloaded 1 file.")).toBeTruthy();
  expect(boundary.run).toHaveBeenCalledOnce();
  expect(boundary.download).toHaveBeenCalledTimes(2);
  expect(toolRuns.log).toHaveBeenCalledOnce();
});

it("accepts dropped files, rejects the wrong format and keeps the uploaded file after a failure", async () => {
  const view = setup();
  fireEvent.drop(view.container.querySelector(".tool-dropzone")!, { dataTransfer: { files: [new File(["bad"], "wrong.txt", { type: "text/plain" })] } });
  expect(view.getByRole("alert")).toHaveTextContent("wrong.txt is not supported");
  expect(boundary.run).not.toHaveBeenCalled();
  fireEvent.drop(view.container.querySelector(".tool-dropzone")!, { dataTransfer: { files: [new File(["source"], "source.bin")] } });
  expect(view.queryByRole("alert")).toBeNull();
  boundary.run.mockRejectedValueOnce(new Error("Cannot read this file"));
  fireEvent.click(view.getByRole("button", { name: "Run Alpha tool" }));
  expect(await view.findByRole("alert")).toHaveTextContent("Cannot read this file");
  expect(view.getByRole("button", { name: "Remove source.bin" })).toBeEnabled();
  fireEvent.click(view.getByRole("button", { name: "Run Alpha tool" }));
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
  fireEvent.click(view.getByRole("button", { name: "Run Beta tool" }));
  await waitFor(() => expect(boundary.run).toHaveBeenCalledWith([second, first], { suffix: "default" }));
  await view.findByText(/Save canceled/);
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
  expect(view.getByRole("heading", { name: "Alpha tool" })).toBeTruthy();
});

it("clears old output when options change and resets files and options on direct tool navigation", async () => {
  const view = setup();
  upload(view.container);
  fireEvent.click(view.getByRole("button", { name: "Run Alpha tool" }));
  await view.findByText(/Save canceled/);
  fireEvent.change(view.getByRole("textbox", { name: "Output suffix" }), { target: { value: "revised" } });
  expect(view.queryByRole("button", { name: "Download results" })).toBeNull();
  fireEvent.click(view.getByRole("link", { name: "Switch tool" }));
  await view.findByText("Beta tool");
  expect(view.queryByRole("button", { name: "Run Beta tool" })).toBeNull();
  upload(view.container);
  expect(view.getByRole("textbox", { name: "Output suffix" })).toHaveValue("default");
  fireEvent.click(view.getByRole("button", { name: "Run Beta tool" }));
  await waitFor(() => expect(boundary.run).toHaveBeenCalledTimes(2));
  expect(boundary.run.mock.calls[1][1]).toEqual({ suffix: "default" });
});

