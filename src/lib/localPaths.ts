// Desktop-only storage-location helpers: where the local database lives and
// where generated documents are written as real files.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";

export const hasTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const EXPORT_DIR_KEY = "filey_export_dir";

/** Native folder picker. Returns the chosen path, or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const res = await openDialog({ directory: true, multiple: false });
  return typeof res === "string" ? res : null;
}

// ---- database folder (Rust-backed, survives restarts) ----
export const getDataDir = () => invoke<string>("get_data_dir");
export const setDataDir = (dir: string) => invoke<string>("set_data_dir", { dir });
export const restartApp = () => invoke("restart_app");
export const storageRecoveryStatus = () => invoke<string | null>("storage_recovery_status");
export const cancelPendingStorage = () => invoke("cancel_pending_storage");

// ---- document export folder (device-local setting) ----
export const getExportDir = (): string =>
  (typeof localStorage !== "undefined" && localStorage.getItem(EXPORT_DIR_KEY)) || "";
export const setExportDir = (dir: string) =>
  localStorage.setItem(EXPORT_DIR_KEY, dir);
export const clearExportDir = () => localStorage.removeItem(EXPORT_DIR_KEY);

/** Write document bytes as a real file into the chosen export folder. */
export const writeDocFile = (dir: string, filename: string, bytes: Uint8Array) =>
  invoke<string>("write_doc_file", { dir, filename, bytes: Array.from(bytes) });

/** Desktop "download": prompt for a save location and write the bytes there via
 *  Rust. A browser `<a download>` blob click does NOT save in the Tauri WebView2
 *  webview, so anything user-facing must go through here. Returns the saved path,
 *  or null if the user cancelled the dialog. */
export async function saveBytes(
  filename: string,
  bytes: Uint8Array
): Promise<string | null> {
  const dest = await saveDialog({ defaultPath: filename });
  if (!dest) return null;
  const sep = Math.max(dest.lastIndexOf("/"), dest.lastIndexOf("\\"));
  const dir = sep >= 0 ? dest.slice(0, sep) : ".";
  const name = sep >= 0 ? dest.slice(sep + 1) : dest;
  return writeDocFile(dir, name, bytes);
}

export const openFolder = (path: string) => openPath(path);

/** Small text exports do not need to load the PDF/image conversion toolchain. */
export async function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8"): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  if (hasTauri) { await saveBytes(filename, bytes); return; }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---- backup / restore ----
const BACKUP_FILTER = [{ name: "Filey backup", extensions: ["db"] }];

/** Save-file dialog for an export. Returns the chosen path or null. */
export async function pickSaveFile(defaultName: string): Promise<string | null> {
  const res = await saveDialog({ defaultPath: defaultName, filters: BACKUP_FILTER });
  return res ?? null;
}

/** Open-file dialog for a backup to restore. Returns the chosen path or null. */
export async function pickBackupFile(): Promise<string | null> {
  const res = await openDialog({ multiple: false, filters: BACKUP_FILTER });
  return typeof res === "string" ? res : null;
}

export const backupDb = (dest: string) => invoke<string>("backup_db", { dest });
export const restoreDb = (src: string) => invoke("restore_db", { src });

/** Full backup (DB + My Files blobs) into a folder, and restore from one. */
export interface FullBackupResult { path: string; recoveryCode: string }
export const backupAll = (dest: string) => invoke<FullBackupResult>("backup_all", { dest });
export const restoreAll = (src: string, recoveryCode?: string) => invoke("restore_all", { src, recoveryCode: recoveryCode?.trim() || null });
