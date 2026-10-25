import { assertWorkspaceCurrent, effectiveDataMode, setDataMode, type DataMode } from "./dataMode";
import { supabase } from "./supabase";
import { verifyCloudSession } from "./cloudSession";
import { adoptLocalProfile, getLocalProfile, type Profile } from "./auth";
import {
  assertLocalAccount,
  claimLocalWorkspace,
  localWorkspaceOwner,
  rememberLocalIdentity,
  setLocalSignedIn,
} from "./localAuth";
import { getSyncStatus, isMigrating, resolveSyncConflicts, setAutoSyncEnabled, setMigrating, syncCycle, syncStatusMessage, type SyncStatus } from "./sync";
import { migrateCloudToLocal } from "./migrate";
import { journalSnapshot } from "./localdb";
import { withCloudTransfer } from "./cloudTransfer";
import { switchAccountStore } from "./accountStores";
import { cloudPosition, pullChanges, reconcile, savePosition } from "./changeFeed";

let switching = false;

/** Only curated sync guidance may be shown instead of the generic transfer error. */
export class WorkspaceTransferError extends Error {
  constructor(status: SyncStatus) {
    super(syncStatusMessage(status));
    this.name = "WorkspaceTransferError";
  }
}

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
    // Going local as a different account than the one whose books are on this computer
    // opens that account's own store; the other account's books stay where they are.
    if (target === "local") await switchAccountStore(user.id);
    assertLocalAccount(user.id);
    await verifyCloudSession(supabase, data.session!);
    let localProfile: Profile | null = null;
    if (target === "cloud") {
      onProgress?.("Saving your device changes to Filey Cloud…");
      // The device copy in cloud mode resumes from here instead of copying everything again.
      const position = await cloudPosition(supabase).catch(() => null);
      const synced = await withCloudTransfer(supabase, user.id, async transfer => {
        let synced = await syncCycle(supabase, { manual: true, transfer });
        const failures = getSyncStatus().failures;
        // Enabling cloud chooses this device's edited versions. Unchanged
        // records and cloud-only records keep their cloud versions.
        // A local ownership mismatch can accompany ordinary settings conflicts.
        // The resolver verifies retired-workspace ownership on the server before
        // changing anything; other permission failures must never enter recovery.
        if (!synced && failures?.length && failures.every(f => f.kind === "conflict" || f.kind === "record"
          || (f.kind === "permission" && f.message === "This record belongs to a different company. Switch to its original workspace before uploading.")))
          synced = await resolveSyncConflicts(true, supabase, { pendingOnly: true, transfer });
        return synced;
      });
      if (!synced) throw new WorkspaceTransferError(getSyncStatus());
      if (position) await savePosition(user.id, position).catch(() => {});
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
        // A computer that kept its copy current only fetches what changed since.
        const caughtUp = localWorkspaceOwner() === user.id
          && (await pullChanges(supabase, user.id, { keepUnsent: false })).status === "applied";
        if (!caughtUp && !await reconcile(supabase, user.id, async () => !(await migrateCloudToLocal(onProgress)).some(r => r.error)))
          throw new Error("Incomplete cloud copy");
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
