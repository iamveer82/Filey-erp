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

// ---- document export folder (device-local setting) ----
export const getExportDir = (): string =>
  (typeof localStorage !== "undefined" && localStorage.getItem(EXPORT_DIR_KEY)) || "";
export const setExportDir = (dir: string) =>
  localStorage.setItem(EXPORT_DIR_KEY, dir);
export const clearExportDir = () => localStorage.removeItem(EXPORT_DIR_KEY);

/** Write document bytes as a real file into the chosen export folder. */
export const writeDocFile = (dir: string, filename: string, bytes: Uint8Array) =>
  invoke<string>("write_doc_file", { dir, filename, bytes: Array.from(bytes) });

export const openFolder = (path: string) => openPath(path);

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
export const backupAll = (dest: string) => invoke<string>("backup_all", { dest });
export const restoreAll = (src: string) => invoke("restore_all", { src });
