// Where a file the agent produced actually ends up.
//
// The Tools page asks the user where to save with a native dialog, which is
// right for a button they just pressed. It is wrong for an agent: a dialog per
// output stops an autonomous run dead and waits for a human who may have walked
// away. So agent output is written straight to disk — the export folder from
// Settings when one is set, the desktop otherwise — and the agent reports the
// path back in the chat.

import { hasTauri, getExportDir, writeDocFile, saveBytes } from "./localPaths";

export interface DeliveredFile {
  name: string;
  /** Absolute path on disk (desktop). */
  path?: string;
  /** Object URL (browser build, where there is no disk to write to). */
  url?: string;
}

/** The folder agent output goes to, and why — also shown to the user. */
export async function outputDir(): Promise<{ dir: string; source: "settings" | "desktop" } | null> {
  if (!hasTauri) return null;
  const configured = getExportDir();
  if (configured) return { dir: configured, source: "settings" };
  try {
    const { desktopDir } = await import("@tauri-apps/api/path");
    const dir = await desktopDir();
    return dir ? { dir, source: "desktop" } : null;
  } catch {
    return null;
  }
}

/** Write one produced file where the user will find it. Never throws — a
 *  failed save is reported as a file with no path, so the agent can say so
 *  rather than claiming success. */
export async function deliverFile(f: {
  name: string;
  bytes: Uint8Array;
}): Promise<DeliveredFile> {
  // A fresh buffer: the caller's view may be a slice of a larger allocation,
  // which Rust and Blob both mis-read.
  const bytes = f.bytes.slice();
  if (hasTauri) {
    const target = await outputDir();
    if (target) {
      try {
        return { name: f.name, path: await writeDocFile(target.dir, f.name, bytes) };
      } catch {
        /* fall through to the dialog rather than losing the file */
      }
    }
    const path = await saveBytes(f.name, bytes);
    return { name: f.name, path: path ?? undefined };
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { name: f.name, url };
}
