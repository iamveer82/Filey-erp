import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setCacheOrg } from "../../lib/api";
import { localClient, readBlobBytes } from "../../lib/localdb";
import { listFiles } from "../../lib/files";
import PdfTools from "../PdfTools";

const boundary = vi.hoisted(() => ({ run: vi.fn(), saved: vi.fn(), error: vi.fn() }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: { success: boundary.saved, error: boundary.error, info: vi.fn() } }) }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: { id: "pdf-local-owner" } }) }));
// Use the real local collection/blob storage for all saved output. Only the
// external SDK is replaced, so this integration test never needs a server.
vi.mock("../../lib/supabase", async () => {
  const { localClient } = await import("../../lib/localdb");
  return { sb: () => localClient, supabase: null, isConfigured: true, cloudConfigured: false };
});
vi.mock("../../components/PdfToolbox", () => {
  const tool = { id: "local-save", name: "Local PDF tool", cat: "Convert", desc: "On-device conversion", icon: () => null,
    accept: ".bin", multi: false, run: boundary.run };
  return { PDF_TOOLS: [tool], toolById: (id: string) => id === tool.id ? tool : undefined,
    toolFlow: () => ({ from: "BIN", to: "PDF" }), defaultParams: () => ({}), ToolFields: () => null };
});

const output = new Uint8Array([37, 80, 68, 70, 45, 49, 10, 0, 255]);
const browserArrayBuffer = Blob.prototype.arrayBuffer;
beforeEach(() => {
  // jsdom omits this standard browser API; FileReader reads the real blob.
  if (!browserArrayBuffer) Object.defineProperty(Blob.prototype, "arrayBuffer", { configurable: true, value: function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this);
    });
  } });
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  setCacheOrg(null); setCacheOrg("pdf-local-workspace", "pdf-local-owner");
  boundary.saved.mockClear(); boundary.error.mockClear();
  boundary.run.mockReset().mockResolvedValue([{ name: "local-output.pdf", bytes: output }]);
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); setCacheOrg(null);
  if (!browserArrayBuffer) Reflect.deleteProperty(Blob.prototype, "arrayBuffer");
});

async function generate() {
  const view = render(<MemoryRouter initialEntries={["/tools?tool=local-save"]}><PdfTools /></MemoryRouter>);
  fireEvent.change(view.getByLabelText("Choose files for this tool"), {
    target: { files: [new File(["source"], "source.bin", { type: "application/octet-stream" })] },
  });
  fireEvent.click(view.getByRole("button", { name: "Local PDF tool" }));
  await view.findByRole("region", { name: "Your results" });
  return view;
}

it("saves generated PDF output into the device library with exact bytes and no hosted request", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  const view = await generate();
  expect(view.getByText("Save to My Files keeps a copy on this device.")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Save to My Files" }));
  await waitFor(() => {
    expect(boundary.error.mock.calls).toEqual([]);
    expect(boundary.saved).toHaveBeenCalledWith("Saved 1 file to My Files.");
  });
  const saved = await listFiles();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ name: "local-output.pdf", mime: "application/pdf", size: output.length, tool: "Local PDF tool" });
  expect(await readBlobBytes(saved[0].storagePath)).toEqual(output);
  expect(boundary.run).toHaveBeenCalledOnce();
  expect(network).not.toHaveBeenCalled();
});

it("clears generated files when the account scope changes instead of saving them under another account", async () => {
  const view = await generate();
  expect(view.getByRole("button", { name: "Save to My Files" })).toBeEnabled();
  act(() => { setCacheOrg("different-workspace", "different-owner"); });
  await waitFor(() => expect(view.queryByRole("region", { name: "Your results" })).toBeNull());
  expect(view.queryByRole("button", { name: "Save to My Files" })).toBeNull();
  expect((await localClient.from("user_files").select()).data).toEqual([]);
});

it("refuses an in-flight local save if its account changes before the identity read completes", async () => {
  const view = await generate();
  const session = await localClient.auth.getSession();
  let resume!: (value: typeof session) => void;
  const identity = vi.spyOn(localClient.auth, "getSession").mockReturnValueOnce(new Promise(resolve => { resume = resolve; }));
  fireEvent.click(view.getByRole("button", { name: "Save to My Files" }));
  await waitFor(() => expect(identity).toHaveBeenCalledOnce());
  act(() => { setCacheOrg("different-workspace", "different-owner"); });
  await act(async () => { resume(session); });
  await waitFor(() => expect(boundary.error).toHaveBeenCalledWith("Your workspace changed. Open the file again before continuing."));
  expect(boundary.saved).not.toHaveBeenCalled();
  expect((await localClient.from("user_files").select()).data).toEqual([]);
  expect(Object.keys(localStorage).filter(key => key.startsWith("fileblob:"))).toEqual([]);
});
