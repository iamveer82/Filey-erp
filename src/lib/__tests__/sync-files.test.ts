import { webcrypto } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { localClient, readBlobBytes, journalSnapshot } from "../localdb";
import { pushFileBlobs, pullFileBlobs, syncNow, getSyncStatus } from "../sync";

const uid = "file-test-owner";
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Blob", NodeBlob);
});
afterEach(() => vi.unstubAllGlobals());
function cloud(error: unknown = null) {
  const upload = vi.fn().mockResolvedValue({ data: null, error });
  const download = vi.fn().mockResolvedValue({ data: new Blob(["pdf bytes"]), error: null });
  const rpc = vi.fn().mockResolvedValue({ data: { ok: true, revision: 1 }, error: null });
  const client: any = {
    auth: { getSession: async () => ({ data: { session: { user: { id: uid }, expires_at: Date.now() / 1000 + 3600 } } }) },
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: "default" }, error: null }) }) }), upsert: async () => ({ error: null }) }),
    storage: { from: () => ({ upload, download }) },
  };
  return { client, upload, download, rpc };
}
it("keeps files pending and does not publish metadata when storage rejects an upload", async () => {
  const row = { id: "file-1", owner: "local-user", storage_path: "local-user/invoice.pdf", mime: "application/pdf" };
  await localClient.storage.from("files").upload(row.storage_path, new Blob(["invoice"]));
  await localClient.from("user_files").insert(row);
  const { client, rpc } = cloud({ statusCode: "503", message: "Unavailable" });
  expect(await syncNow(client, { manual: true })).toBe(false);
  expect((await journalSnapshot()).tables.user_files.changed).toEqual(["file-1"]);
  expect(rpc.mock.calls.some(([, args]) => args?.p_table === "user_files")).toBe(false);
  expect(getSyncStatus().state).toBe("error");
});
it("missing bytes are a failure; successful and already-present bytes use the same immutable path", async () => {
  const row = { id: "file-1", storage_path: "local-user/invoice.pdf", mime: "application/pdf" };
  const { client, upload } = cloud();
  expect((await pushFileBlobs(client, uid, [row])).failed).toEqual([row.id]);
  await localClient.storage.from("files").upload(row.storage_path, new Blob(["invoice"]));
  const first = await pushFileBlobs(client, uid, [row]);
  expect(first.failed).toEqual([]);
  expect(first.rows[0].storage_path).toMatch(/^file-test-owner\/synced\/[a-f0-9]{64}\/invoice.pdf$/);
  upload.mockResolvedValue({ data: null, error: { statusCode: "409" } });
  expect((await pushFileBlobs(client, uid, [row])).rows).toEqual(first.rows);
  for (const error of [
    { status: 400, statusCode: "400", message: "The resource already exists" },
    { status: 400, statusCode: "400", message: "Asset Already Exists" },
    { status: 409, statusCode: "ResourceAlreadyExists", message: "Already exists" },
    { status: 400, statusCode: "Duplicate", message: "Already exists" },
  ]) {
    upload.mockResolvedValue({ data: null, error });
    expect((await pushFileBlobs(client, uid, [row])).rows).toEqual(first.rows);
  }
  upload.mockResolvedValue({ data: null, error: { status: 400, statusCode: "400", message: "Invalid upload" } });
  const report = vi.fn();
  expect((await pushFileBlobs(client, uid, [row], report)).failed).toEqual([row.id]);
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: "file", recordId: row.id }));
  expect(upload.mock.calls[0][2].upsert).toBe(false);
});
it("a second device caches cloud PDFs, and failed downloads never pretend the file is present", async () => {
  const { client, download } = cloud();
  const row = { id: "file-1", storage_path: `${uid}/synced/example/invoice.pdf`, mime: "application/pdf" };
  await pullFileBlobs(client, [row]);
  expect(new TextDecoder().decode((await readBlobBytes(row.storage_path))!)).toBe("pdf bytes");
  await pullFileBlobs(client, [row]);
  expect(download).toHaveBeenCalledTimes(1);
  download.mockResolvedValue({ data: null, error: { message: "Offline" } });
  await expect(pullFileBlobs(client, [{ ...row, storage_path: "missing.pdf" }])).rejects.toThrow(/preserved/);
  expect(await readBlobBytes("missing.pdf")).toBeNull();
});
