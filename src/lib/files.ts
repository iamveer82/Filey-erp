import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { OutFile } from "./pdfTools";

/* "My Files" — tool outputs the user chooses to keep in their account. Bytes
 * live in the private `files` Storage bucket under {uid}/{id}/{name}; metadata
 * lives in the user_files table (RLS: owner = auth.uid()). Requires a signed-in
 * Supabase session. */

export interface SavedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  storagePath: string;
  tool: string | null;
  createdAt: number;
}

const BUCKET = "files";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  csv: "text/csv",
  tiff: "image/tiff",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

async function userId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** True when saving to the cloud is possible (configured + signed in). */
export async function canSaveFiles(): Promise<boolean> {
  return (await userId()) !== null;
}

/** Upload a tool output to the user's account. */
export async function saveOutput(out: OutFile, tool?: string): Promise<void> {
  const uid = await userId();
  if (!uid || !supabase) throw new Error("Sign in to save files to your account.");
  const id = newId();
  const mime = mimeOf(out.name);
  const path = `${uid}/${id}/${out.name}`;
  const blob = new Blob([out.bytes.slice()], { type: mime });
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  const ins = await supabase.from("user_files").insert({
    id,
    owner: uid,
    name: out.name,
    mime,
    size: out.bytes.length,
    storage_path: path,
    tool: tool ?? null,
  });
  if (ins.error) {
    // Roll back the orphaned object if the metadata row failed.
    await supabase.storage.from(BUCKET).remove([path]);
    throw ins.error;
  }
}

/** Auto-save a generated document (invoice, receipt, challan, …) to My Files.
 *  Idempotent by name+tool so re-finalizing the same document doesn't pile up
 *  duplicates. Best-effort: silently no-ops when signed out or offline, and
 *  never throws — callers can `void` it without a try/catch. Returns true when
 *  a new file was actually written. */
export async function autoSaveDocument(out: OutFile, tool: string): Promise<boolean> {
  try {
    if (!(await canSaveFiles())) return false;
    const existing = await listFiles();
    if (existing.some((f) => f.name === out.name && f.tool === tool)) return false;
    await saveOutput(out, tool);
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(): Promise<SavedFile[]> {
  const uid = await userId();
  if (!uid || !supabase) return [];
  const { data, error } = await supabase
    .from("user_files")
    .select("id,name,mime,size,storage_path,tool,created_at")
    .eq("owner", uid)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    mime: r.mime as string,
    size: Number(r.size),
    storagePath: r.storage_path as string,
    tool: (r.tool as string) ?? null,
    createdAt: new Date(r.created_at as string).getTime(),
  }));
}

/** Short-lived signed URL for downloading/previewing a saved file. */
export async function fileUrl(f: SavedFile): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(f.storagePath, 120);
  return data?.signedUrl ?? null;
}

export async function deleteFile(f: SavedFile): Promise<void> {
  if (!supabase) return;
  await supabase.storage.from(BUCKET).remove([f.storagePath]);
  await supabase.from("user_files").delete().eq("id", f.id);
}

/** React hook: the signed-in user's saved files + refresh/remove helpers. */
export function useFiles() {
  const [files, setFiles] = useState<SavedFile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFiles(await listFiles());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    files,
    loading,
    refresh,
    remove: async (f: SavedFile) => {
      await deleteFile(f);
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
    },
  };
}
