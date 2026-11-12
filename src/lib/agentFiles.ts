// Where a file the agent produced actually ends up.
//
// The Tools page asks the user where to save with a native dialog, which is
// right for a button they just pressed. It is wrong for an agent: a dialog per
// output stops an autonomous run dead and waits for a human who may have walked
// away. So agent output is written straight to disk — the export folder from
// Settings when one is set, the desktop otherwise — and the agent reports the
// path back in the chat.

import { hasTauri, getExportDir, writeDocFile } from "./localPaths";
import { isNativeApp, nativeFileUrl, saveNativeBytes } from "./nativePlatform";

export interface DeliveredFile {
  name: string;
  /** Absolute desktop path or private native file URI. */
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

/** The last files handed to the owner, kept in memory so a later turn can reopen its own
 *  output ("now sign the PDF you made") by name or by the path it reported. Without it the
 *  agent retried the reported path again and again and every open failed.
 *  ponytail: in-memory, newest 12 / 60 MB; files from before an app restart come from My Files. */
const recent: { name: string; path?: string; bytes: Uint8Array }[] = [];
const RECENT_FILES = 12;
const RECENT_BYTES = 60 * 1024 * 1024;

function remember(name: string, bytes: Uint8Array): { path?: string } {
  const entry: { name: string; path?: string; bytes: Uint8Array } = { name, bytes };
  recent.push(entry);
  while (recent.length > RECENT_FILES || recent.reduce((n, f) => n + f.bytes.length, 0) > RECENT_BYTES) recent.shift();
  return entry;
}

/** A file Filey delivered earlier in this app session, by exact path, exact name or part of the name. */
export function recentDelivery(want: string): { name: string; bytes: Uint8Array } | undefined {
  const key = want.toLowerCase().trim();
  const base = key.split(/[\\/]/).pop() || key;
  const newest = [...recent].reverse();
  const hit = newest.find(f => f.path?.toLowerCase().replace(/\\/g, "/") === key.replace(/\\/g, "/"))
    ?? newest.find(f => f.name.toLowerCase() === base) ?? newest.find(f => f.name.toLowerCase().includes(base));
  return hit && { name: hit.name, bytes: hit.bytes.slice() };
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
  const entry = remember(f.name, bytes);
  const delivered = await deliverBytes(f.name, bytes);
  entry.path = delivered.path;
  return delivered;
}

async function deliverBytes(name: string, bytes: Uint8Array): Promise<DeliveredFile> {
  const f = { name };
  if (isNativeApp()) {
    try {
      const path = await saveNativeBytes(f.name, bytes, false);
      return path ? { name: f.name, path, url: nativeFileUrl(path) } : { name: f.name };
    } catch { return { name: f.name }; }
  }
  if (hasTauri) {
    const target = await outputDir();
    if (target) {
      try {
        // Keep each output stable while an owner reviews a pending send.
        const dir = `${target.dir}/Filey AI/${crypto.randomUUID()}`;
        return { name: f.name, path: await writeDocFile(dir, f.name, bytes) };
      } catch {
        // Remote tasks must not wait for a save dialog on an unattended PC.
      }
    }
    return { name: f.name };
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.click();
  // Chat history owns this URL until its message is removed or the account
  // changes. Revoking after the initial download breaks the visible chip.
  return { name: f.name, url };
}
