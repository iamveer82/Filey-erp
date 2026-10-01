import { Capacitor } from "@capacitor/core";
import { AppLauncher } from "@capacitor/app-launcher";
import { Browser } from "@capacitor/browser";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

function httpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Choose a valid HTTPS link.");
  return url.href;
}

/** Keep external pages outside the app's trusted WebView. */
export async function openNativeExternal(url: string): Promise<void> {
  await Browser.open({ url: httpsUrl(url) });
}

export async function openNativeMessage(url: string): Promise<void> {
  let destination: string;
  if (url.startsWith("sms:")) {
    destination = /^sms:(?:\+[1-9]\d{6,14})?(?:[?&]body=[^#]*)?$/.test(url) ? url : "";
    if (Capacitor.getPlatform() === "ios") destination = destination.replace("?body=", "&body=");
  } else if (url.startsWith("mailto:")) {
    const value = new URL(url), address = decodeURIComponent(value.pathname);
    destination = (!address || /^[^\s@,;<>?&#]+@[^\s@,;<>?&#]+\.[^\s@,;<>?&#]+$/.test(address))
      && [...value.searchParams.keys()].every(key => key === "subject" || key === "body") ? value.href : "";
  } else destination = httpsUrl(url);
  if (!destination) throw new Error("Choose a valid messaging link.");
  const { completed } = await AppLauncher.openUrl({ url: destination });
  if (!completed) throw new Error("No app could open this message draft.");
}

function filename(name: string): string {
  if (!name.trim() || name === "." || name === ".." || name.length > 240 || /[\\/:*?"<>|%]/.test(name)
    || [...name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error("Choose a file name without path separators or special characters.");
  return name;
}

const OUTPUTS = "filey-exports";

/** Share only Filey's own outputs; a restored chat must not expose other files. */
export async function shareNativeFile(uri: string, title?: string, text?: string): Promise<void> {
  const url = new URL(uri);
  if (url.protocol !== "file:" || url.host || url.search || url.hash)
    throw new Error("This file is not a Filey output.");
  const roots = await Promise.all([Directory.Data, Directory.Cache].map(directory =>
    Filesystem.getUri({ directory, path: OUTPUTS })));
  const path = decodeURIComponent(url.pathname);
  if (path.includes("\\") || [...path].some(character => character.charCodeAt(0) < 32)
    || path.split("/").some(segment => segment === "." || segment === ".."))
    throw new Error("This file is not a Filey output.");
  const root = roots.find(entry => path.startsWith(`${decodeURIComponent(new URL(entry.uri).pathname).replace(/\/$/, "")}/`));
  if (!root) throw new Error("This file is not a Filey output.");
  const name = filename(path.slice(path.lastIndexOf("/") + 1));
  let shared = uri;
  // Android's FileProvider shares cache files. Persistent agent outputs stay private.
  if (root === roots[0]) {
    const { data } = await Filesystem.readFile({ path: uri });
    shared = (await Filesystem.writeFile({ directory: Directory.Cache,
      path: `${OUTPUTS}/${crypto.randomUUID()}/${name}`, data, recursive: true })).uri;
  }
  try {
    await Share.share({ files: [shared], title: title || name, text, dialogTitle: "Save or share file" });
  } catch (error) {
    if ((error as Error)?.message === "Share canceled" || (error as Error)?.name === "AbortError")
      throw new DOMException("Sharing cancelled.", "AbortError");
    throw error;
  }
}

/** Direct exports open the share sheet; agent outputs are saved without a dialog. */
export async function saveNativeBytes(name: string, bytes: Uint8Array, share = true): Promise<string | null> {
  const path = `${OUTPUTS}/${crypto.randomUUID()}/${filename(name)}`;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error || new Error("Could not read the file."));
    reader.readAsDataURL(new Blob([bytes.slice()]));
  });
  const { uri } = await Filesystem.writeFile({ path, directory: share ? Directory.Cache : Directory.Data, data, recursive: true });
  if (share) {
    try { await shareNativeFile(uri); }
    catch (error) { if ((error as Error)?.name === "AbortError") return null; throw error; }
  }
  return uri;
}

export const nativeFileUrl = (uri: string): string => Capacitor.convertFileSrc(uri);
