import { hasTauri, saveBytes } from "./localPaths";

/** Media requests never carry a provider credential to a returned CDN URL. */
export async function downloadMedia(
  value: string,
  signal?: AbortSignal
): Promise<Response> {
  const { safeMediaUrl } = await import("./aiMedia");
  const url = safeMediaUrl(value);
  if (hasTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ data: string; mime: string }>("ai_download_media", {
      url,
    });
    const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0));
    return new Response(bytes, { headers: { "content-type": result.mime } });
  }
  return fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
}
export async function saveMediaFile(blob: Blob, name: string) {
  if (hasTauri) return saveBytes(name, new Uint8Array(await blob.arrayBuffer()));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return name;
}
