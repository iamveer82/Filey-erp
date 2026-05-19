import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, isConfigured } from "./supabase";

// ===================================================================
//  Live multi-client sync
//  One shared Postgres-changes channel for the whole app. Any row
//  change on the server (from another desktop, the web build, or a
//  direct DB edit) notifies every mounted page so it refetches —
//  no manual refresh. RLS still applies: a client only ever receives
//  changes for rows it is allowed to read.
// ===================================================================

type Listener = () => void;

const listeners = new Set<Listener>();
let channel: RealtimeChannel | null = null;
let starting = false;

function emit(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // one listener throwing must not starve the others
    }
  }
}

/** Open the single shared channel. Safe to call repeatedly — only the
 *  first call with a session actually wires it up. */
export async function startRealtime(): Promise<void> {
  if (!isConfigured || !supabase || channel || starting) return;
  starting = true;
  try {
    // postgres_changes only honours RLS when the realtime socket carries
    // the user's JWT; without this an RLS-protected table emits nothing.
    const { data } = await supabase.auth.getSession();
    await supabase.realtime.setAuth(data.session?.access_token ?? null);
    channel = supabase
      .channel("filey-live-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public" },
        () => emit()
      )
      .subscribe();
  } finally {
    starting = false;
  }
}

/** Tear the channel down on sign-out so the next user starts clean. */
export function stopRealtime(): void {
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
}

/** Re-run `reload` whenever any row changes on the server. A short
 *  trailing debounce coalesces multi-row writes into one refresh. */
export function useLiveSync(reload: () => void): void {
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener: Listener = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ref.current(), 250);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      clearTimeout(timer);
    };
  }, []);
}
