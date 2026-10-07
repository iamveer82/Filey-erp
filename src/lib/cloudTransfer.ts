import type { SupabaseClient } from "@supabase/supabase-js";
import { assertWorkspaceCurrent, isLocalMode } from "./dataMode";
import { assertLocalAccount, isLocalSignedIn, localWorkspaceOwner } from "./localAuth";

export const LOCAL_TRANSFER_REQUIRED = "Your records stay on this device. Turn on cloud storage and confirm the transfer to upload them.";
declare const transferBrand: unique symbol;
export type CloudTransferPermit = { readonly [transferBrand]: true };
const permits = new WeakMap<CloudTransferPermit, { client: SupabaseClient; uid: string; workspace: string }>();

function workspace(): string {
  const owner = localWorkspaceOwner();
  if (owner && !isLocalSignedIn()) throw new Error("Sign in to this device's workspace first.");
  let profile: { id?: unknown; org_id?: unknown } | null = null;
  try {
    profile = JSON.parse(localStorage.getItem("filey_local_profile") || "{}");
  } catch {
    throw new Error("This device's profile could not be read. Sign in to this device's workspace again before transferring records.");
  }
  return JSON.stringify([owner, profile?.id ?? null, profile?.org_id ?? null, localStorage.getItem("filey_cloud_workspace")]);
}

/** Authorization belongs to one explicit switch, never a persisted preference. */
export function assertCloudTransfer(permit: CloudTransferPermit | undefined, client: SupabaseClient, uid?: string): void {
  const allowed = permit && permits.get(permit);
  if (!allowed || allowed.client !== client) throw new Error(LOCAL_TRANSFER_REQUIRED);
  assertWorkspaceCurrent();
  if (!isLocalMode() || workspace() !== allowed.workspace || (uid && uid !== allowed.uid))
    throw new Error("Your workspace or account changed during transfer. Your remaining records stay on this device.");
  assertLocalAccount(allowed.uid);
}

/** Check after awaited credential reads and immediately before provider dispatch. */
export async function checkCloudTransfer(permit: CloudTransferPermit | undefined, client: SupabaseClient, uid?: string): Promise<void> {
  assertCloudTransfer(permit, client, uid);
  const allowed = permits.get(permit!)!;
  const current = await client.auth.getSession();
  assertCloudTransfer(permit, client, uid);
  if (current.error || current.data.session?.user.id !== allowed.uid)
    throw new Error("Your cloud account changed during transfer. Your remaining records stay on this device.");
}

/** Used by the confirmed local-to-cloud workspace switch; always revoked on exit. */
export async function withCloudTransfer<T>(client: SupabaseClient, uid: string, transfer: (permit: CloudTransferPermit) => Promise<T>): Promise<T> {
  assertWorkspaceCurrent();
  if (!isLocalMode()) throw new Error(LOCAL_TRANSFER_REQUIRED);
  assertLocalAccount(uid);
  const permit = Object.freeze({}) as CloudTransferPermit;
  permits.set(permit, { client, uid, workspace: workspace() });
  try {
    await checkCloudTransfer(permit, client, uid);
    return await transfer(permit);
  } finally { permits.delete(permit); }
}
