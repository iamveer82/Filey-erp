import type { SupabaseClient } from "@supabase/supabase-js";
import { assertLocalAccount } from "./localAuth";
import { assertWorkspaceCurrent } from "./dataMode";

// Only editable personal fields may leave the device. Never sync local role,
// organization, email/auth identity or subscription fields back to profiles.
const fields = ["name", "company", "phone", "username", "avatar", "language", "timezone", "date_format", "time_format"];
const key = (uid: string) => `filey_profile_pending:${uid}`;
function editable(patch: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(fields.filter(f => typeof patch[f] === "string").map(f => [f, patch[f] as string]));
}

export function pendingProfile(uid: string): Record<string, string> {
  const raw = localStorage.getItem(key(uid));
  if (!raw) return {};
  // A damaged queue must report an error, not silently discard the photo.
  return editable(JSON.parse(raw));
}

export function queueProfile(uid: string, patch: Record<string, unknown>): void {
  if (!uid || uid === "local-user") return;
  assertLocalAccount(uid);
  const changes = editable(patch);
  if (!Object.keys(changes).length) return;
  localStorage.setItem(key(uid), JSON.stringify({ ...pendingProfile(uid), ...changes }));
  window.dispatchEvent(new Event("filey:local-write"));
}

export async function syncProfile(client: SupabaseClient, uid: string): Promise<void> {
  const raw = localStorage.getItem(key(uid));
  if (!raw) return;
  assertWorkspaceCurrent();
  assertLocalAccount(uid);
  if ((await client.auth.getSession()).data.session?.user.id !== uid)
    throw new Error("Your session changed. Profile changes are still on this device.");
  const patch = editable(JSON.parse(raw));
  if (Object.keys(patch).length) {
    const { error } = await client.from("profiles").update(patch).eq("id", uid).select("id").single();
    if (error) throw new Error(`Could not sync your profile: ${error.message}`);
  }
  assertWorkspaceCurrent();
  // An edit made during the request must remain pending for the next sync.
  if (localStorage.getItem(key(uid)) === raw) localStorage.removeItem(key(uid));
}
