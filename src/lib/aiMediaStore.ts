import { requireAgentStorageScope } from "./agentStorage";

// Media bytes stay on this device, outside localStorage and the ERP database.
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("filey-ai-media", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("blobs");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  }));
}
export async function mediaBlob(
  id: string,
  scope: string,
  value?: Blob
): Promise<Blob | undefined> {
  requireAgentStorageScope(scope);
  const database = await db();
  requireAgentStorageScope(scope);
  const result = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = database.transaction("blobs", value ? "readwrite" : "readonly");
    const store = tx.objectStore("blobs");
    const request = value
      ? store.put(value, `${scope}:${id}`)
      : store.get(`${scope}:${id}`);
    tx.oncomplete = () => resolve(value ?? (request.result as Blob | undefined));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Media storage was interrupted."));
  });
  requireAgentStorageScope(scope);
  return result;
}
