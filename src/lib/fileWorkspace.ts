import { StorageClient } from "@supabase/storage-js";
import { getCacheScope } from "./api";
import { assertWorkspaceCurrent, isLocalMode } from "./dataMode";
import { sb } from "./supabase";
import { supabaseAnonKey, supabaseUrl } from "./supabaseConfig";

const CHANGED = "Your workspace changed. Open the file again before continuing.";

/** Bind private file bytes and metadata to the identity that reviewed them.
 * Never replace the global SDK's headers: other operations may be in flight. */
export async function fileOperation() {
  const scope = getCacheScope(), local = isLocalMode(), client = sb();
  const current = () => {
    assertWorkspaceCurrent();
    if (scope !== getCacheScope() || local !== isLocalMode()) throw new Error(CHANGED);
    if (local) sb(); // Also refuses a signed-out device workspace.
  };
  const { data, error } = await client.auth.getSession();
  current();
  if (error) throw new Error("Could not verify your file connection. Sign in again.");
  const session = data.session, uid = session?.user.id;
  if (!uid) throw new Error("Sign in to access your files.");
  const separator = scope?.lastIndexOf(":user:") ?? -1;
  const reviewedUser = separator >= 0 ? scope!.slice(separator + 6) : null;
  const org = separator >= 0 ? scope!.slice(0, separator) : null;
  if (!local && (!reviewedUser || reviewedUser !== uid)) throw new Error(CHANGED);
  const token = session?.access_token;
  if (!local && !token?.trim()) throw new Error("Sign in again to access your files.");
  const assertSession = async () => {
    current();
    if (!local) {
      const active = await client.auth.getSession();
      current();
      if (active.error || active.data.session?.user.id !== uid) throw new Error(CHANGED);
    }
  };
  const storage = local ? client.storage : new StorageClient(`${supabaseUrl.replace(/\/$/, "")}/storage/v1`, {
    apikey: supabaseAnonKey, Authorization: `Bearer ${token}`,
  }, async (input, init) => {
    await assertSession();
    const response = await fetch(input, {
      ...init, redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
    });
    await assertSession();
    return response;
  });
  const pin = <T extends { setHeader(name: string, value: string): T }>(query: T): T =>
    local ? query : query.setHeader("Authorization", `Bearer ${token}`);
  return { client, storage, uid, org, local, current, assertSession, pin };
}
