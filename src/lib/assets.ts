import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "./supabase";
import { useAuth } from "./auth";
import { getCacheScope } from "./api";
import { assertWorkspaceCurrent, effectiveDataMode, isLocalMode } from "./dataMode";
import { notifyDataChanged, useLiveSync } from "./realtime";
import { errMsg } from "./format";

export interface SavedAsset {
  id: string;
  name: string;
  dataUrl: string;
  ratio: number;
  createdAt: number;
}

// Old versions used an unowned browser cache. Never silently upload those
// images into the next account to sign in; let the user select and save them.
export function legacyAssets(): SavedAsset[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem("filey.assets.v1") || "[]");
    return Array.isArray(items) ? items.filter((a): a is SavedAsset =>
      a && typeof a.id === "string" && typeof a.name === "string"
      && typeof a.dataUrl === "string" && a.dataUrl.startsWith("data:image/")
      && Number.isFinite(a.ratio) && a.ratio > 0) : [];
  } catch { return []; }
}

const scope = () => `${effectiveDataMode()}:${getCacheScope()}`;
function checkScope(expected: string) {
  assertWorkspaceCurrent();
  if (scope() !== expected) throw new Error("Your workspace changed. Please try again.");
}
async function context() {
  const expected = scope();
  const client = sb();
  const { data, error } = await client.auth.getSession();
  checkScope(expected);
  if (error) throw error;
  const uid = data.session?.user.id;
  if (!uid) throw new Error("Sign in to access your image library.");
  return { client, uid, expected };
}

export async function listAssets(): Promise<SavedAsset[]> {
  const { client, uid, expected } = await context();
  const items: SavedAsset[] = [];
  for (let offset = 0; ; offset += 100) {
    let query = client.from("user_assets")
      .select("id,name,ratio,data_url,created_at")
      .order("created_at", { ascending: false }).order("id");
    // Local collections belong to the single device owner. Pulled rows retain
    // cloud owner IDs; the local shim's session intentionally uses local-user.
    if (!isLocalMode()) query = query.eq("owner", uid).range(offset, offset + 99);
    const { data, error } = await query;
    checkScope(expected);
    if (error) throw error;
    items.push(...(data ?? []).map(r => ({
      id: r.id, name: r.name, ratio: r.ratio, dataUrl: r.data_url,
      createdAt: Date.parse(r.created_at),
    })));
    if (isLocalMode() || (data ?? []).length < 100) return items;
  }
}

/** Local writes enter the same durable sync journal as invoices and files. */
export async function saveAsset(name: string, dataUrl: string, ratio: number): Promise<SavedAsset> {
  if (!dataUrl.startsWith("data:image/") || !Number.isFinite(ratio) || ratio <= 0)
    throw new Error("Choose a valid image before saving.");
  const { client, uid, expected } = await context();
  const item = { id: crypto.randomUUID(), name: name.trim() || "Untitled", dataUrl, ratio, createdAt: Date.now() };
  const { error } = await client.from("user_assets").insert({
    id: item.id, owner: uid, name: item.name, ratio, data_url: dataUrl,
    created_at: new Date(item.createdAt).toISOString(),
  });
  checkScope(expected);
  if (error) throw error;
  notifyDataChanged(["user_assets"]);
  return item;
}

export async function deleteAsset(id: string): Promise<void> {
  const { client, uid, expected } = await context();
  let query = client.from("user_assets").delete().eq("id", id);
  if (!isLocalMode()) query = query.eq("owner", uid);
  const { error } = await query;
  checkScope(expected);
  if (error) throw error;
  notifyDataChanged(["user_assets"]);
}

export function useAssets() {
  useAuth(); // Re-render on identity/workspace changes; never display a prior user's images.
  const currentScope = scope();
  const [result, setResult] = useState<{ scope: string; assets: SavedAsset[]; error: string }>({ scope: currentScope, assets: [], error: "" });
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const attempt = ++request.current;
    try {
      const assets = await listAssets();
      if (attempt === request.current && scope() === currentScope)
        setResult({ scope: currentScope, assets, error: "" });
    } catch (error) {
      if (attempt === request.current && scope() === currentScope)
        setResult(previous => ({ scope: currentScope, assets: previous.scope === currentScope ? previous.assets : [], error: errMsg(error) }));
    }
  }, [currentScope]);
  useEffect(() => { void refresh(); return () => { ++request.current; }; }, [refresh]);
  useLiveSync(refresh, ["user_assets"]);
  return {
    assets: result.scope === currentScope ? result.assets : [],
    error: result.scope === currentScope ? result.error : "",
    refresh,
    save: async (name: string, dataUrl: string, ratio: number) => {
      const item = await saveAsset(name, dataUrl, ratio);
      await refresh();
      return item;
    },
    remove: async (id: string) => { await deleteAsset(id); await refresh(); },
  };
}
