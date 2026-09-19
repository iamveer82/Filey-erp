import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, isConfigured } from "./supabase";

// ===================================================================
//  Live multi-client sync
//  One shared Postgres-changes channel for the whole app. Any row
//  change on the server (from another desktop, the web build, or a
//  direct DB edit) notifies the mounted consumers of that table —
//  no manual refresh. RLS still applies: a client only ever receives
//  changes for rows it is allowed to read.
// ===================================================================

type Listener = (tables?: readonly string[]) => void;

const listeners = new Set<Listener>();
let channel: RealtimeChannel | null = null;
let starting = false;
let generation = 0;

function emit(tables?: readonly string[]): void {
  for (const l of listeners) {
    try {
      l(tables);
    } catch {
      // one listener throwing must not starve the others
    }
  }
}

/** Nudge affected mounted pages to reload. Used by the cache layer when a
 *  background revalidation finds the server copy differs from what was just
 *  served, so a stale-while-revalidate read still converges on the truth. */
export function notifyDataChanged(tables?: readonly string[]): void {
  emit(tables);
}

/** Open the single shared channel. Safe to call repeatedly — only the
 *  first call with a session actually wires it up. */
export async function startRealtime(): Promise<void> {
  if (!isConfigured || !supabase || channel || starting) return;
  const attempt = generation;
  starting = true;
  try {
    // postgres_changes only honours RLS when the realtime socket carries
    // the user's JWT; without this an RLS-protected table emits nothing.
    const { data } = await supabase.auth.getSession();
    if (attempt !== generation || !data.session) return;
    await supabase.realtime.setAuth(data.session?.access_token ?? null);
    if (attempt !== generation) return;
    channel = supabase
      .channel("filey-live-sync")
      .on("postgres_changes", { event: "*", schema: "public" }, payload => {
        const tables = payload.table ? [payload.table] : undefined;
        window.dispatchEvent(new CustomEvent("filey:cloud-change", { detail: { tables } }));
        emit(tables);
      })
      .subscribe();
  } finally {
    if (attempt === generation) starting = false;
  }
}

/** Tear the channel down on sign-out so the next user starts clean. */
export function stopRealtime(): void {
  generation++;
  starting = false;
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
}

/** Background phones/tabs do not need a permanent database-change stream.
 * Reopening after a pause catches up through the normal authorized reads. */
export function watchRealtimeSession(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let paused = false;
  const connect = () => { void startRealtime().catch(() => {}); };
  const visibility = () => {
    clearTimeout(timer);
    if (document.visibilityState === "hidden") {
      timer = setTimeout(() => { paused = true; stopRealtime(); }, 60_000);
    } else {
      connect();
      if (paused) {
        paused = false;
        window.dispatchEvent(new Event("filey:cloud-change"));
        notifyDataChanged();
      }
    }
  };
  connect(); visibility();
  document.addEventListener("visibilitychange", visibility);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", visibility);
    stopRealtime();
  };
}

/** Re-run `reload` after cloud changes, local saves, or a completed sync. A short
 *  trailing debounce coalesces multi-row writes into one refresh. */
export function useLiveSync(reload: () => void, tables?: readonly string[]): void {
  const ref = useRef({ reload, tables });
  ref.current = { reload, tables };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    const listener: Listener = changed => {
      if (changed?.length && ref.current.tables && !changed.some(table => ref.current.tables!.includes(table))) return;
      clearTimeout(timer);
      dirty = true;
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(() => {
        if (document.visibilityState === "hidden") return;
        dirty = false; ref.current.reload();
      }, 250);
    };
    const visible = () => { if (dirty && document.visibilityState !== "hidden") listener(); };
    const local = () => listener();
    listeners.add(listener);
    window.addEventListener("filey:local-write", local);
    window.addEventListener("filey:remote-update", local);
    document.addEventListener("visibilitychange", visible);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("filey:local-write", local);
      window.removeEventListener("filey:remote-update", local);
      document.removeEventListener("visibilitychange", visible);
      clearTimeout(timer);
    };
  }, []);
}
