import { useCallback, useEffect, useState } from "react";
import { sb, isConfigured } from "./supabase";
import { hasTauri, getExportDir, writeDocFile } from "./localPaths";
import type { OutFile } from "./pdfTools";

/** Best-effort: write a generated document as a real file to the user's chosen
 *  documents folder (desktop only, when a folder is set). */
async function exportToFolder(name: string, bytes: Uint8Array): Promise<void> {
  if (!hasTauri) return;
  const dir = getExportDir();
  if (!dir) return;
  try {
    await writeDocFile(dir, name, bytes);
  } catch (e) {
    console.warn("Export to documents folder failed:", e);
  }
}

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
const mimeOf = (name: string) =>
  MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** Make a filename safe as a Storage key segment — strips slashes, traversal
 *  and control chars. The original name is kept in metadata for display. */
export const safeName = (name: string) =>
  name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

async function userId(): Promise<string | null> {
  if (!isConfigured) return null;
  const { data } = await sb().auth.getSession();
  return data.session?.user?.id ?? null;
}

/** True when saving to the cloud is possible (configured + signed in). */
export async function canSaveFiles(): Promise<boolean> {
  return (await userId()) !== null;
}

/** Upload a tool output to the user's account. */
export async function saveOutput(out: OutFile, tool?: string): Promise<void> {
  const uid = await userId();
  if (!uid || !isConfigured) throw new Error("Sign in to save files to your account.");
  const id = newId();
  const mime = mimeOf(out.name);
  const path = `${uid}/${id}/${safeName(out.name)}`;
  const blob = new Blob([out.bytes.slice()], { type: mime });
  const up = await sb().storage
    .from(BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  const ins = await sb().from("user_files").insert({
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
    await sb().storage.from(BUCKET).remove([path]);
    throw ins.error;
  }
}

/** Auto-save a generated document (invoice, receipt, challan, …) to My Files.
 * Idempotent by name+tool so re-saving the same document doesn't pile up
 * duplicates. The PDF is produced lazily via `gen` — only when the user is
 * signed in and no copy exists yet — so callers can fire this on every save
 * without paying the render cost each time. Best-effort: silently no-ops when
 * signed out or offline and never throws. Returns true when a new file was
 * actually written. `name` should include the extension (e.g. "INV-001.pdf"). */
export async function autoSaveDocument(
  name: string,
  tool: string,
  gen: () => Promise<OutFile>
): Promise<boolean> {
  try {
    if (!(await canSaveFiles())) return false;
    const existing = await listFiles();
    if (existing.some((f) => f.name === name && f.tool === tool)) return false;
    const out = await gen();
    await saveOutput(out, tool);
    await exportToFolder(name, out.bytes); // real file to the chosen folder
    return true;
  } catch (e) {
    console.warn("autoSaveDocument failed:", e);
    return false;
  }
}

export async function listFiles(): Promise<SavedFile[]> {
  const uid = await userId();
  if (!uid || !isConfigured) return [];
  const { data, error } = await sb()
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

/** Object URL (`blob:`) for inline preview. Downloads the bytes (local shim or
 * cloud) and wraps them — unlike a `data:` URL this renders in an <iframe> under
 * the desktop CSP and in WebView2's PDF viewer. Caller must revokeObjectURL. */
export async function fileObjectUrl(f: SavedFile): Promise<string | null> {
  if (!isConfigured) return null;
  const { data, error } = await sb().storage.from(BUCKET).download(f.storagePath);
  if (error) throw new Error(error.message || "Could not open this file.");
  return data ? URL.createObjectURL(data) : null;
}

/** Signed URL that forces a download (Content-Disposition: attachment) using
 * the file's display name — used by the explicit Download action. */
export async function downloadUrl(f: SavedFile): Promise<string | null> {
  if (!isConfigured) return null;
  const { data, error } = await sb().storage
    .from(BUCKET)
    .createSignedUrl(f.storagePath, 300, { download: f.name });
  if (error) throw new Error(error.message || "Could not create a download link.");
  return data?.signedUrl ?? null;
}

/** Rename a saved file (metadata only — the storage object keeps its path;
 * downloads use the display name, so the new name is what the user sees). */
export async function renameFile(f: SavedFile, newName: string): Promise<string> {
  let name = newName.trim();
  if (!name) throw new Error("Name cannot be empty.");
  // Preserve the original extension so the file still opens correctly.
  const ext = f.name.includes(".") ? f.name.split(".").pop()! : "";
  if (ext && !name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
    name = `${name}.${ext}`;
  }
  if (!isConfigured) return name;
  const { error } = await sb().from("user_files").update({ name }).eq("id", f.id);
  if (error) throw error;
  return name;
}

/** Longer-lived signed URL for sharing a file (default 7 days). */
export async function shareFileLink(
  f: SavedFile,
  expiresSec = 604800
): Promise<string | null> {
  if (!isConfigured) return null;
  const { data } = await sb().storage
    .from(BUCKET)
    .createSignedUrl(f.storagePath, expiresSec);
  return data?.signedUrl ?? null;
}

/** Document folders surfaced in My Files, mapped from each file's `tool` key.
 * Anything not listed (or with no tool) lands in "Other files". */
export const FILE_FOLDERS: { key: string; label: string; route?: string }[] = [
  { key: "invoice", label: "Invoices", route: "/invoicing" },
  { key: "quotation", label: "Quotations", route: "/quoting" },
  { key: "receipt", label: "Payment Receipts", route: "/payment-receipts" },
  { key: "challan", label: "Delivery Challans", route: "/delivery-challans" },
  { key: "lpo", label: "Purchase Orders", route: "/purchase-orders" },
  { key: "declaration", label: "Declaration Letters", route: "/declaration" },
];

/** The folder key a file belongs to ("other" when its tool isn't a doc type). */
export function folderOf(f: SavedFile): string {
  return FILE_FOLDERS.some((d) => d.key === f.tool) ? (f.tool as string) : "other";
}

/** Upload a user-selected file directly to My Files. */
export async function uploadUserFile(file: File, tool?: string): Promise<void> {
  const uid = await userId();
  if (!uid || !isConfigured) throw new Error("Sign in to upload files.");
  const id = newId();
  const mime = file.type || mimeOf(file.name);
  const path = `${uid}/${id}/${safeName(file.name)}`;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const blob = new Blob([bytes], { type: mime });
  const up = await sb().storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  const ins = await sb().from("user_files").insert({
    id,
    owner: uid,
    name: file.name,
    mime,
    size: bytes.length,
    storage_path: path,
    tool: tool ?? null,
  });
  if (ins.error) {
    await sb().storage.from(BUCKET).remove([path]);
    throw ins.error;
  }
}

export async function deleteFile(f: SavedFile): Promise<void> {
  if (!isConfigured) return;
  await sb().storage.from(BUCKET).remove([f.storagePath]);
  await sb().from("user_files").delete().eq("id", f.id);
}


/** Upload a company-wide asset (stamp/signature/logo/letterhead) to the private
 * `files` bucket under `{uid}/company/{name}`. Returns the storage path and a
 * short-lived signed URL the preview can use. The path is what gets persisted in
 * app_settings so the image follows the user across devices and sessions. */
export async function uploadCompanyAsset(file: File): Promise<{ path: string; url: string }> {
  const uid = await userId();
  if (!uid || !isConfigured) throw new Error("Sign in to upload company assets.");
  const id = newId();
  const mime = file.type || mimeOf(file.name);
  const path = `${uid}/company/${id}/${safeName(file.name)}`;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const blob = new Blob([bytes], { type: mime });
  const up = await sb().storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: true });
  if (up.error) throw up.error;
  const { data: urlData, error: urlErr } = await sb().storage.from(BUCKET).createSignedUrl(path, 300);
  if (urlErr) throw urlErr;
  return { path, url: urlData?.signedUrl ?? "" };
}

/** Re-create a signed URL for a previously-uploaded company asset path. */
export async function companyAssetUrl(path: string, expiresSec = 300): Promise<string | null> {
  if (!isConfigured) return null;
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, expiresSec);
  if (error) {
    console.warn("Failed to create signed URL for company asset", path, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
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
    upload: async (file: File, tool?: string) => {
      await uploadUserFile(file, tool);
      await refresh();
    },
    remove: async (f: SavedFile) => {
      await deleteFile(f);
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
    },
    rename: async (f: SavedFile, newName: string) => {
      const finalName = await renameFile(f, newName);
      await refresh();
      return finalName;
    },
  };
}
