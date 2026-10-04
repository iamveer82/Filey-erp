import { assertWorkspaceCurrent, effectiveDataMode, setDataMode, type DataMode } from "./dataMode";
import { supabase } from "./supabase";
import { verifyCloudSession } from "./cloudSession";
import { adoptLocalProfile, getLocalProfile, type Profile } from "./auth";
import {
  assertLocalAccount,
  claimLocalWorkspace,
  rememberLocalIdentity,
  setLocalSignedIn,
} from "./localAuth";
import { getSyncStatus, isMigrating, resolveSyncConflicts, setAutoSyncEnabled, setMigrating, syncCycle } from "./sync";
import { migrateCloudToLocal } from "./migrate";
import { journalSnapshot } from "./localdb";
import { withCloudTransfer } from "./cloudTransfer";

let switching = false;

/** Change storage only after the destination is usable. Never ends an auth session. */
export async function switchWorkspace(
  target: DataMode,
  onProgress?: (message: string) => void
): Promise<void> {
  assertWorkspaceCurrent();
  const source = effectiveDataMode();
  if (target === source) return;
  if (switching || isMigrating() || getSyncStatus().state === "syncing")
    throw new Error("Wait for the current data transfer to finish before switching.");
  if (!supabase) throw new Error("Cloud is not configured in this build.");
  if (typeof navigator !== "undefined" && !navigator.onLine)
    throw new Error("Connect to the internet to finish saving your data before switching.");
  switching = true;
  let locked = false;
  try {
    // The sync engine owns its own lock. Pause background scheduling instead
    // of taking the migration lock before asking that engine to upload.
    setAutoSyncEnabled(false);
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    if (!user?.id || !user.email)
      throw new Error(
        "Connect your cloud account below before switching. Your current workspace is still open."
      );
    assertLocalAccount(user.id);
    await verifyCloudSession(supabase, data.session!);
    let localProfile: Profile | null = null;
    if (target === "cloud") {
      onProgress?.("Saving your device changes to Filey Cloud…");
      const synced = await withCloudTransfer(supabase, user.id, async transfer => {
        let synced = await syncCycle(supabase, { manual: true, transfer });
        const failures = getSyncStatus().failures;
        // Enabling cloud chooses this device's edited versions. Unchanged
        // records and cloud-only records keep their cloud versions.
        if (!synced && failures?.length && failures.every(f => f.kind === "conflict" || f.kind === "record"))
          synced = await resolveSyncConflicts(true, supabase, { pendingOnly: true, transfer });
        return synced;
      });
      if (!synced) throw new Error("Couldn't finish saving to Filey Cloud. Your device data is safe. Check your connection and try again.");
      setMigrating(true);
      locked = true;
    } else {
      setMigrating(true);
      locked = true;
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      const saved = getLocalProfile();
      if (profile) assertLocalAccount(user.id, profile.org_id ?? null);
      if (profileError && saved.id !== user.id) throw profileError;
      if (!profile && saved.id !== user.id)
        throw new Error(
          "Your account profile could not be loaded. Retry before opening local storage."
        );
      onProgress?.("Saving your latest cloud data and files on this device…");
      try {
        const result = await migrateCloudToLocal();
        if (result.some(r => r.error)) throw new Error("Incomplete cloud copy");
      } catch (error) {
        console.warn("Workspace download failed", error);
        throw new Error("Couldn't finish saving your cloud data on this device. Filey Cloud is still open. Try again when connected.");
      }
      localProfile = profile as Profile | null;
    }
    // Network checks and a first-device copy can outlive the originating session.
    // Do not claim/sign in the device using an account that has since signed out.
    const current = await supabase.auth.getSession();
    if (current.error) throw current.error;
    assertWorkspaceCurrent();
    if (current.data.session?.user.id !== user.id || effectiveDataMode() !== source)
      throw new Error("Your workspace or account changed. Retry the switch from the current workspace.");
    if (target === "cloud" && Object.keys((await journalSnapshot()).tables).length)
      throw new Error("New changes arrived while switching. Your device is still open; try the switch again.");
    assertLocalAccount(user.id, localProfile?.org_id);
    if (target === "local") {
      claimLocalWorkspace(user.id);
      rememberLocalIdentity(user.email, user.id);
      if (localProfile) adoptLocalProfile(localProfile);
      setLocalSignedIn(true);
    }
    setDataMode(target);
  } finally {
    if (locked) setMigrating(false);
    switching = false;
  }
}
