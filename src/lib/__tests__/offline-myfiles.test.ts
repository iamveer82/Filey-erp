// @vitest-environment jsdom
// Proves My Files + user folders work fully offline (local data mode): the
// localdb shim must back tables (user_files/user_folders), file bytes (storage),
// and the local-user session — no Supabase, no network.
import { beforeAll, test, expect, vi } from "vitest";

beforeAll(() => {
  localStorage.clear();
  // Must be set before importing files.ts → supabase.ts reads it at load.
  localStorage.setItem("filey_data_mode", "local");
  // jsdom's Blob lacks arrayBuffer() (real browsers + Tauri WebView2 have it).
  if (!Blob.prototype.arrayBuffer) {
    // eslint-disable-next-line no-extend-native
    Blob.prototype.arrayBuffer = function () {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as ArrayBuffer);
        fr.onerror = () => reject(fr.error);
        fr.readAsArrayBuffer(this as unknown as Blob);
      });
    };
  }
});

test("private company documents round-trip locally and reject unsupported uploads before saving", async () => {
  const files = await import("../files");
  const file = new File(["%PDF-1.7\nfixture"], "GST certificate.pdf", {type: "application/pdf"});
  const id = await files.uploadUserFile(file, "company-gst");
  const saved = await files.getSavedFile(id);
  expect(saved).toMatchObject({name: file.name, tool: "company-gst", mime: "application/pdf"});
  expect(Array.from((await files.fileBytes(saved))!)).toEqual(Array.from(new Uint8Array(await file.arrayBuffer())));
  expect(files.folderOf(saved)).toBe("company-gst");
  await expect(files.uploadUserFile(new File(["<script>bad</script>"], "PAN.html", {type:"text/html"}), "company-pan")).rejects.toThrow("PDF");
  await expect(files.uploadUserFile(new File(["data"], "PAN.pdf", {type:"text/html"}), "company-pan")).rejects.toThrow("PDF");
  const large = new File(["data"], "large.pdf", {type:"application/pdf"});
  Object.defineProperty(large, "size", {value: 11 * 1024 * 1024});
  await expect(files.uploadUserFile(large, "company-gst")).rejects.toThrow("10 MB");
  // Remove the selected entry first; failed cleanup must preserve its bytes
  // and report that distinction instead of leaving a broken visible record.
  const {sb} = await import("../supabase");
  const storage = vi.spyOn(sb().storage, "from").mockReturnValue({remove: async () => ({error: new Error("Storage denied")})} as never);
  await expect(files.deleteFile(saved)).rejects.toThrow("stored copy could not be deleted");
  storage.mockRestore();
  expect((await files.listFiles()).some(f => f.id === id)).toBe(false);
  expect(await files.fileBytes(saved)).not.toBeNull();
  // With no metadata row left, a retry cannot authorize orphan cleanup. The
  // unreferenced bytes remain safely retained; this is not a successful undo.
  await expect(files.deleteFile(saved)).rejects.toThrow("not found or access denied");
  expect((await files.listFiles()).some(f => f.id === id)).toBe(false);
  expect(await files.fileBytes(saved)).not.toBeNull();
});

test("offline: create folder, save file, move it, read bytes back", async () => {
  const files = await import("../files");

  // Signed-in check passes with the on-device local user (no real auth).
  expect(await files.canSaveFiles()).toBe(true);

  // Create a folder.
  await files.createFolder("Clients", null);
  const folders = await files.listFolders();
  const clients = folders.find((f) => f.name === "Clients");
  expect(clients).toBeTruthy();

  // Save a generated document — bytes go through the local storage shim.
  await files.saveOutput(
    { name: "INV-001.pdf", bytes: new Uint8Array([1, 2, 3, 4]) } as any,
    "invoice"
  );
  let list = await files.listFiles();
  const f = list.find((x) => x.name === "INV-001.pdf");
  expect(f).toBeTruthy();
  expect(f!.folderId).toBeNull(); // lands at root

  // Move it into the folder.
  await files.moveFile(f!.id, clients!.id);
  list = await files.listFiles();
  expect(list.find((x) => x.id === f!.id)!.folderId).toBe(clients!.id);

  // Bytes round-trip from the offline store.
  const bytes = await files.fileBytes(f!);
  expect(bytes ? Array.from(bytes) : null).toEqual([1, 2, 3, 4]);

  // Delete the file, then the now-empty folder.
  await files.deleteFile(f!);
  expect((await files.listFiles()).find((x) => x.id === f!.id)).toBeUndefined();
  await files.deleteFolder(clients!.id);
  expect((await files.listFolders()).find((x) => x.id === clients!.id)).toBeUndefined();
});

test("same-name uploads are filed by their new identity without moving older files", async () => {
  const files = await import("../files");
  await files.createFolder("Upload target", null);
  const folder = (await files.listFolders()).find(f => f.name === "Upload target")!;
  const first = await files.uploadUserFile(new File(["old"], "same.txt"));
  const second = await files.uploadUserFile(new File(["new"], "same.txt"), undefined, folder.id);
  expect((await files.getSavedFile(first)).folderId).toBeNull();
  expect((await files.getSavedFile(second)).folderId).toBe(folder.id);
});
