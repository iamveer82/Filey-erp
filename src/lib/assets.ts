import { useEffect, useState } from "react";

/* Saved-asset library — a personal collection of reusable images (stamps,
 * signatures, logos, watermarks) the user uploads once and applies across
 * tools. Stored in localStorage so it works offline and instantly; the shape
 * is intentionally flat so it can later be mirrored to Supabase storage for
 * cross-device sync without changing call sites. */

export interface SavedAsset {
  id: string;
  name: string;
  dataUrl: string; // normalised PNG data URL
  ratio: number; // natural height / width
  createdAt: number;
}

const KEY = "filey.assets.v1";
const EVENT = "filey-assets-changed";
const MAX = 40;

function read(): SavedAsset[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedAsset[]) : [];
  } catch {
    return [];
  }
}

function write(list: SavedAsset[]) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  window.dispatchEvent(new Event(EVENT));
}

export function listAssets(): SavedAsset[] {
  return read();
}

export function saveAsset(name: string, dataUrl: string, ratio: number): SavedAsset {
  const item: SavedAsset = {
    id: Math.random().toString(36).slice(2, 10),
    name: name.trim() || "Untitled",
    dataUrl,
    ratio,
    createdAt: Date.now(),
  };
  write([item, ...read()]);
  return item;
}

export function deleteAsset(id: string) {
  write(read().filter((a) => a.id !== id));
}

/** React hook: live list of saved assets plus save/remove helpers. */
export function useAssets() {
  const [assets, setAssets] = useState<SavedAsset[]>(read);
  useEffect(() => {
    const refresh = () => setAssets(read());
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return { assets, save: saveAsset, remove: deleteAsset };
}
