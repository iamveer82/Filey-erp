// Where the app keeps its data: "local" (on this device only, never leaves the
// machine) or "cloud" (Supabase). Chosen once at first run; changing it swaps the
// data layer so a reload is required (the setup screen does that).
//
// Device-local by design — the choice itself can't live in the cloud, and a
// local-only install has no Supabase to store it in. Plain localStorage.

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

export function setDataMode(m: DataMode): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, m);
}

export const isLocalMode = (): boolean => getDataMode() === "local";
