import { File as NodeFile } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const fixture = vi.hoisted(() => ({ uid: "owner-a", scope: "org-a:user:owner-a", local: false, upload: vi.fn(), insert: vi.fn(), remove: vi.fn(), download: vi.fn(), signedUrl: vi.fn(), deleteRow: vi.fn(), lookup: vi.fn(), headers: vi.fn(), storageHeaders: vi.fn() }));
vi.mock("../api", () => ({ getCacheScope: () => fixture.scope }));
vi.mock("../dataMode", () => ({ isLocalMode: () => fixture.local, assertWorkspaceCurrent: () => {} }));
vi.mock("@supabase/storage-js", () => ({ StorageClient: class {
  constructor(_url: string, headers: unknown) { fixture.storageHeaders(headers); }
  from() { return { upload: fixture.upload, download: fixture.download, createSignedUrl: fixture.signedUrl, remove: fixture.remove }; }
} }));
vi.mock("../supabase", () => {
  const query = { select: () => query, order: () => query, eq: () => query, range: () => query, limit: () => query,
    setHeader: (name: string, value: string) => { fixture.headers(name, value); return query; },
    then: (resolve: (value: unknown) => void) => fixture.lookup().then(resolve), insert: (value: unknown) => {
      const pending = fixture.insert(value);
      const inserted = { setHeader: (name: string, value: string) => { fixture.headers(name, value); return inserted; }, then: pending.then.bind(pending) };
      return inserted;
    },
    delete: () => {
      let removal: Promise<unknown>;
      const deleted = {
        eq: (column: string, id: string) => { removal = fixture.deleteRow(column, id); return deleted; },
        select: () => deleted, setHeader: (name: string, value: string) => { fixture.headers(name, value); return deleted; },
        then: (resolve: (value: unknown) => void) => removal.then(resolve),
      };
      return deleted;
    } };
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: fixture.uid }, access_token: `token-${fixture.uid}` } } }) }, from: () => query, storage: { from: () => ({ upload: fixture.upload, download: fixture.download, createSignedUrl: fixture.signedUrl, remove: fixture.remove }) } };
  return { isConfigured: true, sb: () => client };
});
vi.mock("../realtime", () => ({ useLiveSync: vi.fn() }));
import { autoSaveDocument, companyAssetUrl, deleteFile, fileBytes, downloadUrl, saveOutput, uploadCompanyAsset, uploadUserFile, useFiles, type SavedFile } from "../files";
import { listAssets, saveAsset } from "../assets";

beforeEach(() => {
  fixture.uid = "owner-a"; fixture.scope = "org-a:user:owner-a"; fixture.local = false;
  fixture.headers.mockClear(); fixture.storageHeaders.mockClear();
  fixture.upload.mockReset().mockResolvedValue({ error: null });
  fixture.insert.mockReset().mockResolvedValue({ error: null });
  fixture.remove.mockReset().mockResolvedValue({ error: null });
  fixture.deleteRow.mockReset().mockResolvedValue({ data: [{ id: "file-one" }], error: null });
  fixture.lookup.mockReset().mockResolvedValue({ data: [], error: null });
  fixture.download.mockReset(); fixture.signedUrl.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["account", "workspace", "storage mode"])("does not upload an earlier customer's generated document after a %s switch", async (change) => {
  const saved = await autoSaveDocument("private-invoice.pdf", "invoice", async () => {
    if (change === "account") { fixture.uid = "owner-b"; fixture.scope = "org-b:user:owner-b"; }
    else if (change === "workspace") fixture.scope = "org-b:user:owner-a";
    else fixture.local = true;
    return { name: "private-invoice.pdf", bytes: new Uint8Array([1, 2, 3]) };
  });
  expect(saved).toBe(false);
  expect(fixture.upload).not.toHaveBeenCalled();
  expect(fixture.insert).not.toHaveBeenCalled();
});

it("rejects a changed authenticated user even before the renderer has adopted its new cache scope", async () => {
  fixture.uid = "owner-b";
  await expect(saveOutput({ name: "private.pdf", bytes: new Uint8Array([1]) }, "invoice", "owner-a")).rejects.toThrow("workspace changed");
  expect(fixture.upload).not.toHaveBeenCalled();
});

it.each(["generated", "selected", "company", "image library"])("never saves %s content into a new session while the cached account is still old", async kind => {
  fixture.uid = "owner-b"; // The SDK can publish its session before React adopts it.
  const selected = new NodeFile(["customer-a-private-bytes"], "private.png", { type: "image/png" }) as unknown as File;
  const saving = kind === "generated" ? saveOutput({ name: "private.pdf", bytes: new Uint8Array([1]) })
    : kind === "selected" ? uploadUserFile(selected)
    : kind === "company" ? uploadCompanyAsset(selected)
    : saveAsset("Owner A private stamp", "data:image/png;base64,Zml4dHVyZQ==", 1);
  await expect(saving).rejects.toThrow("workspace changed");
  expect(fixture.upload).not.toHaveBeenCalled(); expect(fixture.insert).not.toHaveBeenCalled();
  expect(fixture.storageHeaders).not.toHaveBeenCalled();
});

it.each(["bytes", "signed URL", "image library"])("does not publish private %s if only the SDK session changes during its response", async kind => {
  if (kind === "bytes") fixture.download.mockImplementation(async () => { fixture.uid = "owner-b"; return { data: new Blob(["owner-a-private"]), error: null }; });
  else if (kind === "signed URL") fixture.signedUrl.mockImplementation(async () => { fixture.uid = "owner-b"; return { data: { signedUrl: "https://fixture.invalid/?token=owner-a-private" }, error: null }; });
  else fixture.lookup.mockImplementation(async () => { fixture.uid = "owner-b"; return { data: [{ id: "private-stamp", data_url: "data:image/png;base64,cHJpdmF0ZQ==" }], error: null }; });
  const file = { name: "private.pdf", storagePath: "owner-a/private.pdf" } as SavedFile;
  await expect(kind === "bytes" ? fileBytes(file) : kind === "signed URL" ? downloadUrl(file) : listAssets()).rejects.toThrow("workspace changed");
});

it("pins storage and metadata to the reviewed bearer token and organization", async () => {
  await saveOutput({ name: "private.pdf", bytes: new Uint8Array([7]) });
  expect(fixture.storageHeaders).toHaveBeenCalledWith(expect.objectContaining({ Authorization: "Bearer token-owner-a" }));
  expect(fixture.headers).toHaveBeenCalledWith("Authorization", "Bearer token-owner-a");
  expect(fixture.insert).toHaveBeenCalledWith(expect.objectContaining({ owner: "owner-a", org_id: "org-a" }));
});

it("does not log private storage paths or provider error contents when a company image cannot be signed", async () => {
  fixture.signedUrl.mockResolvedValueOnce({ data: null, error: { message: "token=secret-customer-link" } });
  expect(await companyAssetUrl("owner-a/company/private-customer-signature.png")).toBeNull();
  expect(console.warn).toHaveBeenCalledOnce();
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/owner-a|signature|secret-customer/);
});

it("stops a selected local file before upload when its read finishes in another workspace", async () => {
  const file = new NodeFile(["private document"], "private.txt", { type: "text/plain" });
  vi.spyOn(file, "arrayBuffer").mockImplementation(async () => { fixture.scope = "org-b:user:owner-b"; return new ArrayBuffer(1); });
  await expect(uploadUserFile(file as unknown as File)).rejects.toThrow("workspace changed");
  expect(fixture.upload).not.toHaveBeenCalled();
  expect(fixture.insert).not.toHaveBeenCalled();
});

it("saves generated documents to their original signed-in owner when the workspace stays current", async () => {
  expect(await autoSaveDocument("private.pdf", "invoice", async () => ({ name: "private.pdf", bytes: new Uint8Array([1]) }))).toBe(true);
  expect(fixture.upload.mock.calls[0][0]).toMatch(/^owner-a\//);
  expect(fixture.insert).toHaveBeenCalledWith(expect.objectContaining({ owner: "owner-a" }));
});

it.each(["generated", "selected"])("does not finish a %s file save or roll it back in another store after metadata settles", async (kind) => {
  for (const error of [null, { message: "Metadata failed" }]) {
    fixture.local = false;
    fixture.insert.mockImplementationOnce(async () => {
      fixture.local = true;
      return { error };
    });
    const saving = kind === "generated"
      ? saveOutput({ name: "private.pdf", bytes: new Uint8Array([1]) }, "invoice")
      : uploadUserFile(new NodeFile(["private document"], "private.txt", { type: "text/plain" }) as unknown as File);
    await expect(saving).rejects.toThrow("workspace changed");
    expect(fixture.remove).not.toHaveBeenCalled();
  }
});

it("cleans up its own orphaned object after an ordinary metadata failure", async () => {
  fixture.insert.mockResolvedValueOnce({ error: new Error("Metadata failed") });
  await expect(saveOutput({ name: "private.pdf", bytes: new Uint8Array([1]) }, "invoice")).rejects.toThrow("Metadata failed");
  expect(fixture.remove).toHaveBeenCalledExactlyOnceWith([fixture.upload.mock.calls[0][0]]);
});

it.each(["download bytes", "signed link"])("discards a private %s response after an account switch", async (kind) => {
  const file = { name: "private.pdf", storagePath: "owner-a/private.pdf" } as SavedFile;
  const switchAccount = () => { fixture.uid = "owner-b"; fixture.scope = "org-b:user:owner-b"; };
  if (kind === "download bytes") fixture.download.mockImplementation(async () => { switchAccount(); return { data: new Blob(["private"]), error: null }; });
  else fixture.signedUrl.mockImplementation(async () => { switchAccount(); return { data: { signedUrl: "https://example.test/private?token=private" }, error: null }; });
  await expect(kind === "download bytes" ? fileBytes(file) : downloadUrl(file)).rejects.toThrow("workspace changed");
});

const selectedFile = { id: "file-one", name: "invoice.pdf", storagePath: "owner-a/file-one/invoice.pdf" } as SavedFile;
it("preserves file bytes when deleting the metadata is denied", async () => {
  fixture.deleteRow.mockResolvedValue({ error: new Error("Metadata denied") });
  await expect(deleteFile(selectedFile)).rejects.toThrow("Metadata denied");
  expect(fixture.remove).not.toHaveBeenCalled();
});

it.each([{ data: [] }, { data: null }, { data: [{ id: "another-file" }] }])("does not remove bytes when metadata deletion confirms no matching ID ($data)", async ({ data }) => {
  fixture.deleteRow.mockResolvedValue({ data, error: null });
  await expect(deleteFile(selectedFile)).rejects.toThrow("not found or access denied");
  expect(fixture.lookup).not.toHaveBeenCalled();
  expect(fixture.remove).not.toHaveBeenCalled();
});

it("deletes metadata before cleaning a dedicated object and reports cleanup failure honestly", async () => {
  fixture.remove.mockResolvedValueOnce({ error: new Error("Storage denied") });
  await expect(deleteFile(selectedFile)).rejects.toThrow("entry was removed, but its stored copy could not be deleted");
  expect(fixture.deleteRow.mock.invocationCallOrder[0]).toBeLessThan(fixture.remove.mock.invocationCallOrder[0]);
  expect(fixture.remove).toHaveBeenCalledWith([selectedFile.storagePath]);
  fixture.deleteRow.mockResolvedValueOnce({ data: [], error: null });
  await expect(deleteFile(selectedFile)).rejects.toThrow("not found or access denied");
  expect(fixture.remove).toHaveBeenCalledTimes(1);
});

it("refreshes the visible file ledger after partial removal but still rejects failed byte cleanup", async () => {
  let removed = false;
  fixture.lookup.mockImplementation(async () => ({ data: removed ? [] : [{ id: selectedFile.id, name: selectedFile.name, storage_path: selectedFile.storagePath, mime: "application/pdf", size: 12, created_at: "2026-09-30" }], error: null }));
  fixture.deleteRow.mockImplementation(async () => { removed = true; return { data: [{ id: selectedFile.id }], error: null }; });
  fixture.remove.mockResolvedValueOnce({ error: new Error("Storage denied") });
  const { result } = renderHook(() => useFiles());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.files).toHaveLength(1);
  await act(async () => { await expect(result.current.remove(result.current.files[0])).rejects.toThrow("stored copy could not be deleted"); });
  expect(result.current.files).toEqual([]);
  expect(result.current.loading).toBe(false);
});

it("retains legacy content-addressed objects whose other references may be hidden by RLS", async () => {
  await deleteFile({ ...selectedFile, storagePath: `owner-a/synced/${"a".repeat(64)}/invoice.pdf` });
  expect(fixture.deleteRow).toHaveBeenCalledWith("id", selectedFile.id);
  expect(fixture.lookup).not.toHaveBeenCalled();
  expect(fixture.remove).not.toHaveBeenCalled();
});

it.each([true, false])("retains bytes if another reference exists or its lookup fails (reference exists: %s)", async exists => {
  fixture.lookup.mockResolvedValue({ data: exists ? [{ id: "another-file" }] : null, error: exists ? null : new Error("Lookup denied") });
  if (exists) await deleteFile(selectedFile);
  else await expect(deleteFile(selectedFile)).rejects.toThrow("stored copy could not be checked");
  expect(fixture.remove).not.toHaveBeenCalled();
});

it("does not clean a file in a new account when metadata deletion settles after switching", async () => {
  fixture.deleteRow.mockImplementation(async () => { fixture.scope = "org-b:user:owner-b"; return { error: null }; });
  await expect(deleteFile(selectedFile)).rejects.toThrow("workspace changed");
  expect(fixture.remove).not.toHaveBeenCalled();
});
