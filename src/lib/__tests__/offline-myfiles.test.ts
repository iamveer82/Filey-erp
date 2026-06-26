// @vitest-environment jsdom
// Proves My Files + user folders work fully offline (local data mode): the
// localdb shim must back tables (user_files/user_folders), file bytes (storage),
// and the local-user session — no Supabase, no network.
import { beforeAll, test, expect } from "vitest";

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
