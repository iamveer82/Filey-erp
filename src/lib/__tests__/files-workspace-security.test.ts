import { File as NodeFile } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ uid: "owner-a", scope: "org-a:owner-a", local: false, upload: vi.fn(), insert: vi.fn(), remove: vi.fn(), download: vi.fn(), signedUrl: vi.fn() }));
vi.mock("../api", () => ({ getCacheScope: () => fixture.scope }));
vi.mock("../dataMode", () => ({ isLocalMode: () => fixture.local }));
vi.mock("../supabase", () => {
  const query = { select: () => query, order: () => query, eq: () => query, range: () => query, then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }), insert: fixture.insert };
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: fixture.uid } } } }) }, from: () => query, storage: { from: () => ({ upload: fixture.upload, download: fixture.download, createSignedUrl: fixture.signedUrl, remove: fixture.remove }) } };
  return { isConfigured: true, sb: () => client };
});
vi.mock("../realtime", () => ({ useLiveSync: vi.fn() }));
import { autoSaveDocument, fileBytes, downloadUrl, saveOutput, uploadUserFile, type SavedFile } from "../files";

beforeEach(() => {
  fixture.uid = "owner-a"; fixture.scope = "org-a:owner-a"; fixture.local = false;
  fixture.upload.mockReset().mockResolvedValue({ error: null });
  fixture.insert.mockReset().mockResolvedValue({ error: null });
  fixture.remove.mockReset().mockResolvedValue({ error: null });
  fixture.download.mockReset(); fixture.signedUrl.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it.each(["account", "workspace", "storage mode"])("does not upload an earlier customer's generated document after a %s switch", async (change) => {
  const saved = await autoSaveDocument("private-invoice.pdf", "invoice", async () => {
    if (change === "account") { fixture.uid = "owner-b"; fixture.scope = "org-b:owner-b"; }
    else if (change === "workspace") fixture.scope = "org-b:owner-a";
    else fixture.local = true;
    return { name: "private-invoice.pdf", bytes: new Uint8Array([1, 2, 3]) };
  });
  expect(saved).toBe(false);
  expect(fixture.upload).not.toHaveBeenCalled();
  expect(fixture.insert).not.toHaveBeenCalled();
});

it("rejects a changed authenticated user even before the renderer has adopted its new cache scope", async () => {
  fixture.uid = "owner-b";
  await expect(saveOutput({ name: "private.pdf", bytes: new Uint8Array([1]) }, "invoice", "owner-a")).rejects.toThrow("account changed");
  expect(fixture.upload).not.toHaveBeenCalled();
});

it("stops a selected local file before upload when its read finishes in another workspace", async () => {
  const file = new NodeFile(["private document"], "private.txt", { type: "text/plain" });
  vi.spyOn(file, "arrayBuffer").mockImplementation(async () => { fixture.scope = "org-b:owner-b"; return new ArrayBuffer(1); });
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
  const switchAccount = () => { fixture.uid = "owner-b"; fixture.scope = "org-b:owner-b"; };
  if (kind === "download bytes") fixture.download.mockImplementation(async () => { switchAccount(); return { data: new Blob(["private"]), error: null }; });
  else fixture.signedUrl.mockImplementation(async () => { switchAccount(); return { data: { signedUrl: "https://example.test/private?token=private" }, error: null }; });
  await expect(kind === "download bytes" ? fileBytes(file) : downloadUrl(file)).rejects.toThrow("workspace changed");
});
