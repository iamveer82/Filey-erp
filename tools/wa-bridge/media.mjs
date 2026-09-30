/** Mirror Baileys' URL choice before downloading untrusted attachment metadata.
 * Its fallback concatenates the directPath with the media host, so a path that
 * begins with '@' can otherwise turn that host into URL credentials. */
export function mediaRequestOptions(media) {
  const prefix = "https://mmg.whatsapp.net/";
  const advertised = media?.url;
  const directPath = media?.directPath;
  let downloadUrl;
  if (typeof advertised === "string" && advertised.startsWith(prefix)) {
    downloadUrl = advertised;
  } else {
    if (typeof directPath !== "string" || !directPath.startsWith("/") || directPath.startsWith("//") || directPath.includes("\\")) {
      throw new Error("Invalid WhatsApp attachment location.");
    }
    downloadUrl = `https://mmg.whatsapp.net${directPath}`;
  }
  if (downloadUrl.length > 4096 || [...downloadUrl].some(char => char.charCodeAt(0) <= 0x20)) {
    throw new Error("Invalid WhatsApp attachment location.");
  }
  const url = new URL(downloadUrl);
  if (url.protocol !== "https:" || url.hostname !== "mmg.whatsapp.net" || url.port || url.username || url.password) {
    throw new Error("Invalid WhatsApp attachment location.");
  }
  // Never follow a media response to another host. Bound the initial HTTP
  // request as well as the decrypted stream consumed by the caller.
  return { timeout: 30_000, maxRedirects: 0 };
}
