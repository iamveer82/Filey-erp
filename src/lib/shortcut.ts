/* First-run desktop shortcut prompt (Windows desktop app only).
 *
 * On the first launch of the installed app, asks the user — once per device —
 * whether to place a "Filey ERP" shortcut (with the mascot icon, embedded in
 * the exe) on their Desktop. Consent → Rust `create_desktop_shortcut`, which
 * writes the .lnk via WScript.Shell. The flag is stored locally so the prompt
 * never repeats; failures stay silent (the app works fine without a shortcut).
 */
import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { hasDesktop } from "./updater";

const KEY = "shortcut.prompted";

export async function maybePromptDesktopShortcut(): Promise<void> {
  if (!hasDesktop) return;
  try {
    if (localStorage.getItem(KEY)) return;
    localStorage.setItem(KEY, "1"); // ask once, even if dismissed
    const yes = await ask("Create a Desktop shortcut for quick access?", {
      title: "Filey ERP",
      kind: "info",
      okLabel: "Create shortcut",
      cancelLabel: "Not now",
    });
    if (yes) await invoke("create_desktop_shortcut");
  } catch (e) {
    console.warn("Desktop shortcut prompt skipped:", e);
  }
}
