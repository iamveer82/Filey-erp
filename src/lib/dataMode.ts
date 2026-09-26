// Where the app keeps its data: "local" (on this device only, never leaves the
// machine) or "cloud" (Supabase). Chosen once at first run; changing it swaps the
// data layer so a reload is required (the setup screen does that).
//
// Device-local by design — the choice itself can't live in the cloud, and a
// local-only install has no Supabase to store it in. Plain localStorage.

import { cloudConfigured } from "./supabaseConfig";

export type DataMode = "local" | "cloud";

const KEY = "filey_data_mode";
let changedInAnotherTab = false;
let changingWorkspace = false;
export function setWorkspaceTransition(active: boolean): void {
  changingWorkspace = active;
  window.dispatchEvent(new CustomEvent("filey:workspace-transition",{detail:active}));
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key === null || (event.key === KEY && event.oldValue !== event.newValue)
      || (event.key === "filey_cloud_workspace" && !isLocalMode() && event.oldValue !== event.newValue)) {
      changedInAnotherTab = true;
      window.dispatchEvent(new Event("filey:workspace-changed"));
    }
  });

export function assertWorkspaceCurrent(): void {
  if (changingWorkspace && !isLocalMode()) throw new Error("Your workspace is changing. Please wait.");
  if (changedInAnotherTab)
    throw new Error(
      "Workspace changed in another tab. Reload this workspace before continuing."
    );
}

export function getDataMode(): DataMode | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(KEY);
  return v === "local" || v === "cloud" ? v : null;
}

// The hosted web build skips the storage picker (App.tsx only shows SetupNotice
// on desktop / unconfigured builds), so on web `filey_data_mode` is normally
// ABSENT. The data layer treats an absent mode as whichever store this build
// actually talks to, and anything that keys data or gates a read has to agree
// with it — otherwise a scope built here is the string "null" and a signed-in
// web user gets told to "sign in to this workspace" by features that only ever
// needed an account. cloudConfigured comes from a leaf module, not supabase.ts,
// so this stays a DAG: supabase.ts already asks this module about local mode.
let implicit: DataMode | null = null;

/** Test/override hook. Normally unset — the build's own config decides. */
export function setImplicitDataMode(mode: DataMode | null): void {
  implicit = mode;
}

/** The mode in force, whether or not the user ever chose one. Prefer this over
 *  getDataMode() for anything that keys data or gates a read: it matches the
 *  client sb() hands out, so the two can't disagree. */
export function effectiveDataMode(): DataMode {
  return getDataMode() ?? implicit ?? (cloudConfigured ? "cloud" : "local");
}

export function setDataMode(m: DataMode): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, m);
}

export const isLocalMode = (): boolean => effectiveDataMode() === "local";
