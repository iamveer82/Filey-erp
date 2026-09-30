import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CompanyDocuments from "../CompanyDocuments";
import { fileObjectUrl, useFiles } from "../../lib/files";
import { saveMediaFile } from "../../lib/mediaDownload";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), refresh: vi.fn() }));
vi.mock("../../lib/ui", () => ({useUI: () => ({toast: {success: mocks.success, error: mocks.error}, confirm: mocks.confirm})}));
vi.mock("../../lib/mediaDownload", () => ({saveMediaFile: vi.fn(async () => "downloaded")}));
vi.mock("../../lib/files", async original => ({
  ...await original<typeof import("../../lib/files")>(),
  useFiles: vi.fn(), fileObjectUrl: vi.fn(async () => "blob:private-fixture"), fileBytes: vi.fn(async () => new Uint8Array([1,2,3])),
}));
afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();});

it("keeps saved documents across country switches and wires private upload, preview, download and confirmed deletion", async () => {
  const file = {id:"fixture", name:"License.png", mime:"image/png", size:3, storagePath:"owner/private/License.png", tool:"company-license", folderId:null, createdAt:0};
  vi.mocked(useFiles).mockReturnValue({files:[file], loading:false, error:"", refresh:mocks.refresh, upload:mocks.upload, remove:mocks.remove} as unknown as ReturnType<typeof useFiles>);
  const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static revokeObjectURL = revoke; });
  const view = render(<CompanyDocuments country="IN" />);
  expect(screen.getByText(file.name)).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Document type" }), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("option", { name: "GST certificate" }), { key: "Enter" });
  const pdf = new File(["%PDF"], "GST.pdf", {type:"application/pdf"});
  fireEvent.change(screen.getByLabelText("Upload company document"), {target:{files:[pdf]}});
  await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(pdf, "company-gst"));
  await waitFor(() => expect(screen.getByRole("button", {name:"Upload document"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button", {name:`View ${file.name}`}));
  expect(await screen.findByAltText(file.name)).toHaveAttribute("src", "blob:private-fixture");
  expect(fileObjectUrl).toHaveBeenCalledWith(file);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name:"Download"}));
  await waitFor(() => expect(saveMediaFile).toHaveBeenCalledWith(expect.any(Blob), file.name));
  fireEvent.click(screen.getByRole("button", {name:"Close dialog"}));
  expect(revoke).toHaveBeenCalledWith("blob:private-fixture");
  await waitFor(() => expect(screen.getByRole("button", {name:`Delete ${file.name}`})).toBeEnabled());
  mocks.confirm.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button", {name:`Delete ${file.name}`}));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  expect(mocks.remove).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", {name:`Delete ${file.name}`})).toBeEnabled());
  mocks.confirm.mockResolvedValueOnce(true);
  mocks.remove.mockRejectedValueOnce(new Error("Delete denied"));
  fireEvent.click(screen.getByRole("button", {name:`Delete ${file.name}`}));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Delete denied"));
  expect(mocks.success).not.toHaveBeenCalledWith("Document deleted.");
  view.rerender(<CompanyDocuments country="AE" />);
  expect(screen.getByLabelText("Document type")).toHaveTextContent("Company registration");
});
