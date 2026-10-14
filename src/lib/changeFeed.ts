/* Change feed (supabase/2026-10-14-sync-change-feed.sql): a device asks the cloud
 * "what changed since my position?" and downloads only those rows. When nothing
 * changed that is one tiny request; its own uploads come back as ids it already
 * holds at that revision, so they are not downloaded again.
 *
 * The position names the workspace it belongs to and lives in device storage
 * next to the records, so a restored backup brings back both together. A device
 * without a usable position (first copy, another workspace, away longer than the
 * cloud keeps changes) makes one complete copy and resumes from the position
 * taken just before it. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { journalSnapshot, journalVersion, loadColl, replaceColl } from "./localdb";
import { readDeviceValue, writeDeviceValue } from "./deviceStorage";
import { LARGE_BODY_TABLES, pullFileBlobs } from "./sync";
import { PUSH_TABLES } from "./syncTables";

export interface FeedPosition { cursor: string; org: string }
export type FeedOutcome =
  | { status: "applied"; tables: string[] }
  /** No usable position: make a complete copy with `reconcile`. */
  | { status: "reconcile" }
  /** A local save landed meanwhile; nothing was lost, ask again later. */
  | { status: "busy" };

const PUSH_SET = new Set<string>(PUSH_TABLES);
/** More changes than this since the last ask: one complete copy is cheaper. */
const FEED_LIMIT = 2000;
const WEEK_MS = 7 * 24 * 60 * 60_000;
const positionKey = (uid: string) => `filey:sync-position:${uid}`;
const completeKey = (uid: string) => `filey:sync-complete:${uid}`;

export async function readPosition(uid: string): Promise<FeedPosition | null> {
  try {
    const value = JSON.parse((await readDeviceValue(positionKey(uid))) || "null");
    return value && typeof value.cursor === "string" && typeof value.org === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function savePosition(uid: string, position: FeedPosition): Promise<void> {
  await writeDeviceValue(positionKey(uid), JSON.stringify({ cursor: position.cursor, org: position.org }));
}

/** Where the cloud stands now. Take it BEFORE a complete copy, save it after. */
export async function cloudPosition(client: SupabaseClient): Promise<FeedPosition> {
  const { data, error } = await client.rpc("filey_sync_cursor");
  if (error || typeof data?.cursor !== "string") throw new Error(error?.message || "The cloud position is unavailable.");
  return { cursor: data.cursor, org: String(data.org) };
}

/** A complete check is also made weekly, as a safety net under the feed. */
export function completeCopyDue(uid: string): boolean {
  try { return Date.now() - Number(localStorage.getItem(completeKey(uid)) || 0) > WEEK_MS; } catch { return false; }
}

/** One complete copy with `copy`, after which the feed resumes from just before it. */
export async function reconcile(client: SupabaseClient, uid: string, copy: () => Promise<boolean>): Promise<boolean> {
  // An older cloud without the feed still gets its complete copy.
  const position = await cloudPosition(client).catch(() => null);
  if (!(await copy())) return false;
  if (position) await savePosition(uid, position);
  try { localStorage.setItem(completeKey(uid), String(Date.now())); } catch { /* checked again next week */ }
  return true;
}

async function fetchRows(client: SupabaseClient, table: string, ids: string[]): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  const size = LARGE_BODY_TABLES.has(table) ? 5 : 200;
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await client.from(table).select("*").in("id", ids.slice(i, i + size));
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, any>[]));
  }
  return rows;
}

/** Downloads the rows changed in the cloud since this device's position.
 *  `keepUnsent`: rows edited here and not yet uploaded stay as they are; their
 *  upload compares revisions and any conflict goes to review, as before. */
export async function pullChanges(client: SupabaseClient, uid: string, opts: { keepUnsent: boolean }): Promise<FeedOutcome> {
  const position = await readPosition(uid);
  if (!position) return { status: "reconcile" };
  const { data, error } = await client.rpc("filey_sync_changes", { p_since: position.cursor, p_limit: FEED_LIMIT });
  if (error) {
    if (error.code === "PGRST202") return { status: "reconcile" };
    throw new Error(`Could not check cloud changes: ${error.message}`);
  }
  if (!data || data.stale || data.org !== position.org || typeof data.cursor !== "string" || !Array.isArray(data.changes))
    return { status: "reconcile" };

  const byTable = new Map<string, { up: Map<string, number>; down: Set<string> }>();
  for (const change of data.changes as { t?: unknown; id?: unknown; op?: unknown; rev?: unknown }[]) {
    if (typeof change?.t !== "string" || !PUSH_SET.has(change.t) || typeof change.id !== "string") continue;
    const entry = byTable.get(change.t) ?? { up: new Map(), down: new Set() };
    if (change.op === "u" && typeof change.rev === "number") entry.up.set(change.id, change.rev);
    else entry.down.add(change.id);
    byTable.set(change.t, entry);
  }

  const before = await journalSnapshot();
  const tables: string[] = [];
  for (const [table, { up, down }] of byTable) {
    const unsent = opts.keepUnsent ? before.tables[table] : undefined;
    if (unsent?.all) continue;
    const mine = new Set([...(unsent?.changed ?? []), ...(unsent?.deleted ?? [])].map(String));
    const local = await loadColl(table);
    const held = new Map(local.map(row => [String(row.id), row as Record<string, any>]));
    const need = [...up].filter(([id, rev]) => !mine.has(id) && held.get(id)?.sync_revision !== rev).map(([id]) => id);
    const gone = [...down].filter(id => !mine.has(id) && held.has(id));
    if (!need.length && !gone.length) continue;
    const fetched = await fetchRows(client, table, need);
    if (table === "user_files" && fetched.length) await pullFileBlobs(client, fetched);
    const fresh = new Map(fetched.map(row => [String(row.id), row]));
    // Rows that vanished between the feed and the fetch leave too.
    const remove = new Set([...gone, ...need.filter(id => !fresh.has(id))]);
    const next = local.filter(row => !remove.has(String(row.id))).map(row => fresh.get(String(row.id)) ?? row);
    for (const row of fetched) if (!held.has(String(row.id))) next.push(row);
    await replaceColl(table, next, before.v);
    if ((await journalVersion()) !== before.v) return { status: "busy" };
    tables.push(table);
  }
  await savePosition(uid, { cursor: data.cursor, org: data.org });
  return { status: "applied", tables };
}
