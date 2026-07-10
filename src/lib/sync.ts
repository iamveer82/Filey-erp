// Automatic local → cloud sync. While the app runs in LOCAL mode, every write
// is journalled (localdb.ts); this module debounces those events and pushes the
// dirty collections to the signed-in Supabase account, so the hosted web
// version always shows what the desktop has.
//
// Direction is one-way and THIS DEVICE WINS: rows are upserted by id, local
// deletes delete cloud rows. Edits made in the web version to the same records
// are overwritten on the next push — the desktop is the source of truth.
//
// Requires a cloud session. In local mode the app itself authenticates against
// the local shim, so the real supabase-js client is signed in separately
// (cloudSignIn below); its session persists in localStorage across restarts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { isLocalMode } from "./dataMode";
import { PUSH_TABLES } from "./syncTables";
import {
  loadColl,
  readBlobBytes,
  journalSnapshot,
  journalCommit,
  journalMark,
} from "./localdb";

const FILES_BUCKET = "files";
const ENABLED_KEY = "filey_auto_sync"; // "off" disables; anything else = on

export const autoSyncEnabled = (): boolean =>
  typeof localStorage === "undefined" || localStorage.getItem(ENABLED_KEY) !== "off";

export function setAutoSyncEnabled(on: boolean): void {
  if (on) localStorage.removeItem(ENABLED_KEY);
  else localStorage.setItem(ENABLED_KEY, "off");
  notify();
  if (on) scheduleSync(500);
}

export interface SyncStatus {
  state: "idle" | "signed-out" | "syncing" | "done" | "error";
  at?: string; // last successful push
  error?: string;
}

let status: SyncStatus = { state: "idle" };
export const getSyncStatus = (): SyncStatus => status;

function notify(): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("filey:sync-status"));
}

function setStatus(s: SyncStatus): void {
  status = { at: status.at, ...s };
  notify();
}

/** Strip ownership columns the cloud re-stamps (user_id default, force_org_id
 *  trigger); "owner" columns and local file paths need the real uid. Shared
 *  with the one-time migration so both push paths clean rows identically. */
export function cleanRowForPush(row: Record<string, any>, uid: string): Record<string, any> {
  const { user_id: _u, org_id: _o, ...rest } = row;
  if ("owner" in rest) rest.owner = uid;
  if (typeof rest.storage_path === "string")
    rest.storage_path = rest.storage_path.replace(/^local-user\//, `${uid}/`);
  return rest;
}

async function pushFileBlobs(
  supa: SupabaseClient,
  uid: string,
  rows: { storage_path?: string }[]
): Promise<void> {
  for (const f of rows) {
    const localPath = f.storage_path;
    if (!localPath) continue;
    try {
      const bytes = await readBlobBytes(localPath);
      if (!bytes) continue;
      const cloudPath = localPath.replace(/^local-user\//, `${uid}/`);
      await supa.storage
        .from(FILES_BUCKET)
        .upload(cloudPath, new Blob([new Uint8Array(bytes)]), { upsert: true });
    } catch {
      /* skip individual file failures — rows still sync */
    }
  }
}

let running = false;

/** Push everything the journal marked dirty. Returns true when the push ran to
 *  completion (including "nothing to do"). `client` is injectable for tests. */
export async function syncNow(client?: SupabaseClient | null): Promise<boolean> {
  const supa = client ?? supabase;
  if (!isLocalMode() || !supa || !autoSyncEnabled() || running) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;

  const { data: sess } = await supa.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) {
    setStatus({ state: "signed-out" });
    return false;
  }

  const j = await journalSnapshot();
  const dirty = PUSH_TABLES.filter((t) => j.tables[t]);
  if (!dirty.length) {
    setStatus({ state: "done" });
    return true;
  }

  running = true;
  setStatus({ state: "syncing" });
  try {
    // Deletes first, children before parents (reverse FK order).
    for (const t of [...dirty].reverse()) {
      const ids = j.tables[t].deleted;
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await supa
          .from(t)
          .delete()
          .in("id", ids.slice(i, i + 100));
        if (error) throw new Error(`${t}: ${error.message}`);
      }
    }

    // Upserts parents-first. Whole collection per dirty table — collections
    // are small on a single-user desktop and upserts are idempotent.
    let pushedAny = false;
    for (const t of dirty) {
      const rows = await loadColl(t);
      const cleaned = rows.map((r) => cleanRowForPush(r, uid));
      for (let i = 0; i < cleaned.length; i += 200) {
        const { error } = await supa
          .from(t)
          .upsert(cleaned.slice(i, i + 200), { onConflict: "id" });
        if (error) throw new Error(`${t}: ${error.message}`);
      }
      if (rows.length) pushedAny = true;
      if (t === "user_files") await pushFileBlobs(supa, uid, rows);
    }

    // Pushed rows kept their local ids — bump identity sequences past them so
    // web-side inserts don't collide.
    if (pushedAny) {
      try {
        await supa.rpc("sync_bump_sequences");
      } catch {
        /* older cloud DBs without the fn */
      }
    }

    // Bookkeeping the web UI can show ("desktop last synced …"). Best-effort:
    // older cloud DBs may not have the table yet.
    const now = new Date().toISOString();
    await supa
      .from("sync_state")
      .upsert(
        dirty.map((t) => ({ user_id: uid, table_name: t, synced_at: now })),
        { onConflict: "user_id,table_name" }
      );

    await journalCommit(j.v, dirty);
    setStatus({ state: "done", at: now });
    return true;
  } catch (e: any) {
    setStatus({ state: "error", error: e?.message ?? String(e) });
    return false;
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced sync — a burst of writes becomes one push. */
export function scheduleSync(delayMs = 4000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delayMs);
}

/** Wire up auto-sync for the app's lifetime. Call once at startup; no-op
 *  outside local mode or in builds without cloud config. */
export function startAutoSync(): void {
  if (typeof window === "undefined") return;
  if (!isLocalMode() || !supabase) return;
  window.addEventListener("filey:local-write", () => scheduleSync());
  window.addEventListener("online", () => scheduleSync(1000));
  scheduleSync(3000); // catch up on writes made while offline or signed out
}

/** Mark every non-empty local collection dirty, then sync — the "upload all my
 *  local data" action for a first-time connect against a non-empty cloud. */
export async function markAllForSync(): Promise<void> {
  for (const t of PUSH_TABLES) {
    if ((await loadColl(t)).length) await journalMark(t);
  }
}

// ---- cloud session helpers (local mode signs into the shim, not the cloud;
// the real client needs its own sign-in for sync to have someone to push as) --

export async function cloudSessionEmail(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.email ?? null;
}

export async function cloudSignIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error("Cloud isn't configured in this build.");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  setStatus({ state: "idle" });
  scheduleSync(500);
}

export async function cloudSignOut(): Promise<void> {
  await supabase?.auth.signOut();
  setStatus({ state: "signed-out" });
}
