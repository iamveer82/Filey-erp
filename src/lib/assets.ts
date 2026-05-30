import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/* Saved-asset library — a personal collection of reusable images (stamps,
 * signatures, logos, watermarks) applied across the PDF tools.
 *
 * Sync model: when the user is signed in to Supabase the `user_assets` table
 * is the source of truth (cross-device). localStorage is always kept as a
 * mirror so the library loads instantly and still works offline / signed-out.
 * The same id is used locally and remotely so deletes line up either way. */

export interface SavedAsset {
  id: string;
  name: string;
  dataUrl: string; // normalised PNG data URL
  ratio: number; // natural height / width
  createdAt: number;
}

const KEY = "filey.assets.v1";
const EVENT = "filey-assets-changed";
const MAX = 60;

function readLocal(): SavedAsset[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedAsset[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: SavedAsset[]) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  window.dispatchEvent(new Event(EVENT));
}

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export function listAssets(): SavedAsset[] {
  return readLocal();
}

/** Persist an asset locally (and remotely when signed in). Returns the item. */
export async function saveAsset(
  name: string,
  dataUrl: string,
  ratio: number
): Promise<SavedAsset> {
  const item: SavedAsset = {
    id: newId(),
    name: name.trim() || "Untitled",
    dataUrl,
    ratio,
    createdAt: Date.now(),
  };
  writeLocal([item, ...readLocal()]); // optimistic
  const uid = await currentUserId();
  if (uid && supabase) {
    await supabase
      .from("user_assets")
      .insert({ id: item.id, owner: uid, name: item.name, ratio, data_url: dataUrl });
  }
  return item;
}

export async function deleteAsset(id: string) {
  writeLocal(readLocal().filter((a) => a.id !== id)); // optimistic
  const uid = await currentUserId();
  if (uid && supabase) await supabase.from("user_assets").delete().eq("id", id);
}

/** Pull the signed-in user's assets from Supabase and mirror them locally. */
async function pullRemote(): Promise<SavedAsset[] | null> {
  const uid = await currentUserId();
  if (!uid || !supabase) return null;
  const { data, error } = await supabase
    .from("user_assets")
    .select("id,name,ratio,data_url,created_at")
    .eq("owner", uid)
    .order("created_at", { ascending: false });
  if (error || !data) return null;
  const list: SavedAsset[] = data.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    ratio: r.ratio as number,
    dataUrl: r.data_url as string,
    createdAt: new Date(r.created_at as string).getTime(),
  }));
  writeLocal(list);
  return list;
}

/** React hook: live list of saved assets plus save/remove helpers. */
export function useAssets() {
  const [assets, setAssets] = useState<SavedAsset[]>(readLocal);

  useEffect(() => {
    let dead = false;
    void pullRemote().then((list) => {
      if (!dead && list) setAssets(list);
    });
    const refresh = () => setAssets(readLocal());
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      dead = true;
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return {
    assets,
    save: async (name: string, dataUrl: string, ratio: number) => {
      const item = await saveAsset(name, dataUrl, ratio);
      setAssets(readLocal());
      return item;
    },
    remove: async (id: string) => {
      await deleteAsset(id);
      setAssets(readLocal());
    },
  };
}
