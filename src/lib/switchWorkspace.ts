import { assertWorkspaceCurrent, getDataMode, setDataMode, type DataMode } from "./dataMode";
import { supabase } from "./supabase";
import { hasLocalData } from "./license";
import { adoptLocalProfile, getLocalProfile, type Profile } from "./auth";
import {
  assertLocalAccount,
  claimLocalWorkspace,
  rememberLocalIdentity,
  setLocalSignedIn,
} from "./localAuth";
import { getSyncStatus, isMigrating, setMigrating } from "./sync";
import { migrateCloudToLocal } from "./migrate";

/** Change storage only after the destination is usable. Never ends an auth session. */
export async function switchWorkspace(
  target: DataMode,
  copyCloud = false
): Promise<void> {
  assertWorkspaceCurrent();
  const source = getDataMode();
  if (target === source) return;
  if (isMigrating() || getSyncStatus().state === "syncing")
    throw new Error("Wait for the current data transfer to finish before switching.");
  if (!supabase) throw new Error("Cloud is not configured in this build.");
  setMigrating(true);
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    if (!user?.id || !user.email)
      throw new Error(
        "Connect your cloud account below before switching. Your current workspace is still open."
      );
    assertLocalAccount(user.id);
    let localProfile: Profile | null = null;
    if (target === "cloud") {
      const verified = await supabase.auth.getUser();
      if (verified.error) throw verified.error;
      if (verified.data.user?.id !== user.id)
        throw new Error(
          "Your cloud session changed. Reconnect the workspace account before switching."
        );
    } else {
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
      if (copyCloud) {
        if (await hasLocalData())
          throw new Error("This device already has records. Resume its workspace, or use the explicit import action after making a backup.");
        const result = await migrateCloudToLocal();
        const failed = result.filter((r) => r.error);
        if (failed.length)
          throw new Error(
            `Copy incomplete: ${failed.map((r) => r.table).join(", ")}. Storage was not switched.`
          );
      }
      localProfile = profile as Profile | null;
    }
    // Network checks and a first-device copy can outlive the originating session.
    // Do not claim/sign in the device using an account that has since signed out.
    const current = await supabase.auth.getSession();
    if (current.error) throw current.error;
    assertWorkspaceCurrent();
    if (current.data.session?.user.id !== user.id || getDataMode() !== source)
      throw new Error("Your workspace or account changed. Retry the switch from the current workspace.");
    assertLocalAccount(user.id, localProfile?.org_id);
    if (target === "local") {
      claimLocalWorkspace(user.id);
      rememberLocalIdentity(user.email, user.id);
      if (localProfile) adoptLocalProfile(localProfile);
      setLocalSignedIn(true);
    }
    setDataMode(target);
  } finally {
    setMigrating(false);
  }
}
