/* Auto-update bridge over tauri-plugin-updater.
 *
 * On a signed release published to the configured endpoint (see
 * src-tauri/tauri.conf.json → plugins.updater), check() reports the new version
 * + release notes; installUpdate() downloads, installs and relaunches. All
 * desktop-only and fully graceful — if the updater isn't reachable/configured,
 * it just reports "no update" and never throws into the UI.
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export const hasDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string;
  /** The raw plugin object — pass to installUpdate(). Not serializable. */
  handle: Update;
}

/**
 * Same check, but failures throw. A user who pressed "Check for updates"
 * needs "couldn't reach the update server" told apart from "you're up to
 * date" — the silent version below reports both as null.
 */
export async function checkForUpdateStrict(): Promise<UpdateInfo | null> {
  if (!hasDesktop) return null;
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? "",
    handle: update,
  };
}

/** Returns update info if a newer signed release is available, else null. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    return await checkForUpdateStrict();
  } catch (e) {
    // No endpoint yet, offline, bad signature, etc. — silently no-update.
    console.warn("Update check skipped:", e);
    return null;
  }
}

/** Download + install the update, reporting 0–100 progress, then relaunch. */
export async function installUpdate(
  update: Update,
  onProgress?: (pct: number) => void
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((ev) => {
    switch (ev.event) {
      case "Started":
        total = ev.data.contentLength ?? 0;
        onProgress?.(0);
        break;
      case "Progress":
        downloaded += ev.data.chunkLength;
        if (total > 0) onProgress?.(Math.min(99, Math.round((downloaded / total) * 100)));
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  });
  await relaunch();
}
