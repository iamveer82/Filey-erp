import { useCallback, useEffect, useRef, useState } from "react";
import { sb, isConfigured } from "./supabase";
import { isLocalMode } from "./dataMode";
import { hasTauri, getExportDir, writeDocFile } from "./localPaths";
import type { OutFile } from "./pdfTools";
import { errMsg } from "./format";
import { useLiveSync } from "./realtime";
import { validateDocumentUpload } from "./documentUpload";
import { getCacheScope } from "./api";

/** Never carry a pending file operation into a different account or store. */
function fileWorkspace() {
  const scope = getCacheScope(), local = isLocalMode();
  return () => {
    sb(); // Also refuses a signed-out device or another tab's pending transition.
    if (scope !== getCacheScope() || local !== isLocalMode())
      throw new Error("Your workspace changed. Open the file again before saving it.");
  };
}

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("Could not read file."));
    r.readAsDataURL(file);
  });

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
  /** User folder the file is filed under (null = root / unfiled). */
  folderId: string | null;
  createdAt: number;
}

/** A user-created folder in My Files (parentId null = top level). */
export interface UserFolder {
  id: string;
  name: string;
  parentId: string | null;
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
  xml: "application/xml",
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

/** Upload a tool output to the user's account. Returns the saved file's id so
 *  a caller can reference it later (a cheque photo, for instance, is attached
 *  to its record by id rather than re-found by name). */
export async function saveOutput(out: OutFile, tool?: string, expectedUserId?: string): Promise<string> {
  const current = fileWorkspace();
  const uid = await userId();
  current();
  if (!uid || !isConfigured) throw new Error("Sign in to save files to your account.");
  if (expectedUserId && uid !== expectedUserId) throw new Error("Your account changed. Generate the document again before saving it.");
  const id = newId();
  const mime = mimeOf(out.name);
  const path = `${uid}/${id}/${safeName(out.name)}`;
  const blob = new Blob([out.bytes.slice()], { type: mime });
  const up = await sb().storage
    .from(BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  current();
  const ins = await sb().from("user_files").insert({
    id,
    owner: uid,
    name: out.name,
    mime,
    size: out.bytes.length,
    storage_path: path,
    tool: tool ?? null,
  });
  current();
  if (ins.error) {
    // Roll back the orphaned object if the metadata row failed.
    await sb().storage.from(BUCKET).remove([path]);
    throw ins.error;
  }
  return id;
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
    const current = fileWorkspace();
    const uid = await userId();
    current();
    if (!uid) return false;
    const existing = await listFiles();
    current();
    if (existing.some((f) => f.name === name && f.tool === tool)) return false;
    const out = await gen();
    current();
    await saveOutput(out, tool, uid);
    current();
    await exportToFolder(name, out.bytes); // real file to the chosen folder
    return true;
  } catch (e) {
    console.warn("autoSaveDocument failed:", e);
    return false;
  }
}

export async function listFiles(): Promise<SavedFile[]> {
  const current = fileWorkspace();
  const uid = await userId();
  current();
  if (!uid || !isConfigured) throw new Error("Sign in to access your files.");
  const files: SavedFile[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = sb()
      .from("user_files")
      .select("id,name,mime,size,storage_path,tool,folder_id,created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    if (!isLocalMode()) query = query.eq("owner", uid).range(offset, offset + 499);
    const { data, error } = await query;
    current();
    if (error) throw error;
    files.push(...(data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      mime: r.mime as string,
      size: Number(r.size),
      storagePath: r.storage_path as string,
      tool: (r.tool as string) ?? null,
      folderId: (r.folder_id as string) ?? null,
      createdAt: new Date(r.created_at as string).getTime(),
    })));
    if (isLocalMode() || (data ?? []).length < 500) return files;
  }
}

/** Read one linked receipt without downloading the user's whole file library. */
export async function getSavedFile(id: string): Promise<SavedFile> {
  const current = fileWorkspace();
  const { data, error } = await sb().from("user_files").select("*").eq("id", id).single();
  current();
  if (error || !data) throw new Error("This attachment is unavailable or you do not have access to it.");
  return { id: data.id, name: data.name, mime: data.mime, size: Number(data.size), storagePath: data.storage_path,
    tool: data.tool ?? null, folderId: data.folder_id ?? null, createdAt: Date.parse(data.created_at) };
}

/* ---------------- User folders ---------------- */

export async function listFolders(): Promise<UserFolder[]> {
  const current = fileWorkspace();
  const uid = await userId();
  current();
  if (!uid || !isConfigured) throw new Error("Sign in to access your folders.");
  const folders: UserFolder[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = sb()
      .from("user_folders")
      .select("id,name,parent_id,created_at")
      .order("name", { ascending: true })
      .order("id", { ascending: true });
    if (!isLocalMode()) query = query.eq("owner", uid).range(offset, offset + 499);
    const { data, error } = await query;
    current();
    if (error) throw error;
    folders.push(...(data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      parentId: (r.parent_id as string) ?? null,
      createdAt: new Date(r.created_at as string).getTime(),
    })));
    if (isLocalMode() || (data ?? []).length < 500) return folders;
  }
}

export async function createFolder(
  name: string,
  parentId: string | null
): Promise<void> {
  const current = fileWorkspace();
  const uid = await userId();
  current();
  if (!uid || !isConfigured) throw new Error("Sign in to create folders.");
  const n = name.trim();
  if (!n) throw new Error("Folder name cannot be empty.");
  const { error } = await sb()
    .from("user_folders")
    .insert({ id: newId(), owner: uid, name: n, parent_id: parentId });
  if (error) throw error;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n) throw new Error("Folder name cannot be empty.");
  if (!isConfigured) return;
  const { error } = await sb().from("user_folders").update({ name: n }).eq("id", id);
  if (error) throw error;
}

/** Delete a folder. Caller must ensure it is empty (no subfolders, no files);
 *  the DB still set-nulls any stray files and cascade-removes subfolders as a
 *  backstop. */
export async function deleteFolder(id: string): Promise<void> {
  if (!isConfigured) return;
  const { error } = await sb().from("user_folders").delete().eq("id", id);
  if (error) throw error;
}

/** Move a file into a folder (null = root). */
export async function moveFile(
  fileId: string,
  folderId: string | null
): Promise<void> {
  if (!isConfigured) return;
  const { error } = await sb()
    .from("user_files")
    .update({ folder_id: folderId })
    .eq("id", fileId);
  if (error) throw error;
}

/** Re-parent a folder (null = top level). Caller guards against cycles. */
export async function moveFolder(
  id: string,
  parentId: string | null
): Promise<void> {
  if (!isConfigured) return;
  const { error } = await sb()
    .from("user_folders")
    .update({ parent_id: parentId })
    .eq("id", id);
  if (error) throw error;
}

/** Object URL (`blob:`) for inline preview. Downloads the bytes (local shim or
 * cloud) and wraps them — unlike a `data:` URL this renders in an <iframe> under
 * the desktop CSP and in WebView2's PDF viewer. Caller must revokeObjectURL. */
export async function fileObjectUrl(f: SavedFile): Promise<string | null> {
  if (!isConfigured) return null;
  const current = fileWorkspace();
  const { data, error } = await sb().storage.from(BUCKET).download(f.storagePath);
  current();
  if (error) throw new Error(error.message || "Could not open this file.");
  return data ? URL.createObjectURL(data) : null;
}

/** Raw bytes of a saved file. Used to render PDFs with pdf.js without going
 * through a blob: URL + fetch() (which the webview CSP blocks on connect-src). */
export async function fileBytes(f: SavedFile): Promise<Uint8Array | null> {
  if (!isConfigured) return null;
  const current = fileWorkspace();
  const { data, error } = await sb().storage.from(BUCKET).download(f.storagePath);
  current();
  if (error) throw new Error(error.message || "Could not open this file.");
  if (!data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  current();
  return bytes;
}

/** Signed URL that forces a download (Content-Disposition: attachment) using
 * the file's display name — used by the explicit Download action. */
export async function downloadUrl(f: SavedFile): Promise<string | null> {
  if (!isConfigured) return null;
  const current = fileWorkspace();
  const { data, error } = await sb().storage
    .from(BUCKET)
    .createSignedUrl(f.storagePath, 300, { download: f.name });
  current();
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
  const current = fileWorkspace();
  const { data } = await sb().storage
    .from(BUCKET)
    .createSignedUrl(f.storagePath, expiresSec);
  current();
  return data?.signedUrl ?? null;
}

/** Document folders surfaced in My Files, mapped from each file's `tool` key.
 * Anything not listed (or with no tool) lands in "Other files". */
export const COMPANY_DOCUMENT_TYPES = [
  { key: "company-gst", label: "GST certificate", country: "IN" },
  { key: "company-pan", label: "PAN document", country: "IN" },
  { key: "company-aadhaar", label: "Masked Aadhaar copy", country: "IN" },
  { key: "company-udyam", label: "Udyam certificate", country: "IN" },
  { key: "company-vat", label: "VAT certificate", country: "AE" },
  { key: "company-license", label: "Trade licence", country: "AE" },
  { key: "company-registration", label: "Company registration", country: null },
  { key: "company-other", label: "Other business document", country: null },
] as const;

export const FILE_FOLDERS: { key: string; label: string; route?: string }[] = [
  ...COMPANY_DOCUMENT_TYPES.map(({key, label}) => ({key, label, route: "/settings?section=company"})),
  { key: "invoice", label: "Invoices", route: "/invoicing" },
  { key: "quotation", label: "Quotations", route: "/quoting" },
  { key: "receipt", label: "Payment Receipts", route: "/payment-receipts" },
  { key: "challan", label: "Delivery Challans", route: "/delivery-challans" },
  { key: "lpo", label: "Purchase Orders", route: "/purchase-orders" },
  { key: "expense-receipt", label: "Expense Receipts", route: "/purchase" },
  { key: "declaration", label: "Declaration Letters", route: "/declaration" },
];

/** The folder key a file belongs to ("other" when its tool isn't a doc type). */
export function folderOf(f: SavedFile): string {
  return FILE_FOLDERS.some((d) => d.key === f.tool) ? (f.tool as string) : "other";
}

/** Upload a user-selected file directly to My Files. */
export async function uploadUserFile(file: File, tool?: string, folderId?: string | null): Promise<string> {
  const current = fileWorkspace();
  const documentType = COMPANY_DOCUMENT_TYPES.find(t => t.key === tool);
  const documentMime = documentType ? validateDocumentUpload(file) : undefined;
  const uid = await userId();
  current();
  if (!uid || !isConfigured) throw new Error("Sign in to upload files.");
  const id = newId();
  const mime = documentMime || file.type || mimeOf(file.name);
  const path = `${uid}/${id}/${safeName(file.name)}`;
  const buf = await file.arrayBuffer();
  current();
  const bytes = new Uint8Array(buf);
  const blob = new Blob([bytes], { type: mime });
  const up = await sb().storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  current();
  const ins = await sb().from("user_files").insert({
    id,
    owner: uid,
    name: file.name,
    folder_id: folderId ?? null,
    mime,
    size: bytes.length,
    storage_path: path,
    tool: tool ?? null,
  });
  current();
  if (ins.error) {
    await sb().storage.from(BUCKET).remove([path]);
    throw ins.error;
  }
  return id;
}

export async function deleteFile(f: SavedFile): Promise<void> {
  if (!isConfigured) throw new Error("File storage is not configured.");
  const current = fileWorkspace();
  const { data: removed, error } = await sb().from("user_files").delete().eq("id", f.id).select("id");
  if (error) throw error;
  current();
  // RLS can acknowledge a DELETE while matching no accessible row. That is
  // not permission to remove an object's bytes from another workspace.
  if (!Array.isArray(removed) || removed.length !== 1 || removed[0].id !== f.id)
    throw new Error("File not found or access denied. Refresh your files.");
  const parts = f.storagePath.split("/");
  const fileId = encodeURIComponent(f.id).replace(/\./g, "%2E");
  const dedicated = (parts.length === 3 && parts[1] === f.id)
    || (parts.length === 5 && parts[1] === "synced" && parts[2] === fileId && /^[a-f0-9]{64}$/.test(parts[3]));
  // Older synced objects were shared by content, even across workspaces. RLS
  // cannot prove they are unreferenced, so retain them rather than break another
  // file. New uploads bind their object to this file's ID.
  if (!dedicated) return;
  const { data: references, error: lookupError } = await sb().from("user_files")
    .select("id").eq("storage_path", f.storagePath).limit(1);
  current();
  if (lookupError) throw new Error("The file entry was removed, but its stored copy could not be checked.");
  if (references?.length) return;
  const { error: storageError } = await sb().storage.from(BUCKET).remove([f.storagePath]);
  current();
  if (storageError) throw new Error("The file entry was removed, but its stored copy could not be deleted.");
}


/** Upload a company-wide asset (stamp/signature/logo/letterhead) to the private
 * `files` bucket under `{uid}/company/{name}`. Returns the storage path and a
 * short-lived signed URL the preview can use. The path is what gets persisted in
 * app_settings so the image follows the user across devices and sessions. */
export async function uploadCompanyAsset(file: File): Promise<{ path: string; url: string }> {
  const current = fileWorkspace();
  // Local mode: embed the image directly as a data: URL stored in app_settings.
  // Avoids the Storage path + signed-URL round-trip (disk write, keyring-encrypted
  // read), which can silently fail to resolve offline and leaves the stamp blank.
  // Stamp/signature/logo PNGs are small enough to live in settings.
  if (isLocalMode()) {
    const dataUrl = await fileToDataUrl(file);
    current();
    return { path: dataUrl, url: dataUrl };
  }
  const uid = await userId();
  current();
  if (!uid || !isConfigured) throw new Error("Sign in to upload company assets.");
  const id = newId();
  const mime = file.type || mimeOf(file.name);
  const path = `${uid}/company/${id}/${safeName(file.name)}`;
  const buf = await file.arrayBuffer();
  current();
  const bytes = new Uint8Array(buf);
  const blob = new Blob([bytes], { type: mime });
  const up = await sb().storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  current();
  const { data: urlData, error: urlErr } = await sb().storage.from(BUCKET).createSignedUrl(path, 300);
  current();
  if (urlErr) throw urlErr;
  return { path, url: urlData?.signedUrl ?? "" };
}

/** Re-create a signed URL for a previously-uploaded company asset path. */
export async function companyAssetUrl(path: string, expiresSec = 300): Promise<string | null> {
  if (!isConfigured) return null;
  const current = fileWorkspace();
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, expiresSec);
  current();
  if (error) {
    console.warn("Failed to create signed URL for company asset", path, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** React hook: the signed-in user's saved files + folders + helpers. */
export function useFiles() {
  const [files, setFiles] = useState<SavedFile[]>([]);
  const [folders, setFolders] = useState<UserFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError("");
    try {
      const [fs, fl] = await Promise.all([listFiles(), listFolders()]);
      if (current !== request.current) return;
      setFiles(fs);
      setFolders(fl);
    } catch (cause) {
      if (current === request.current) setError(`Could not load your files: ${errMsg(cause)}`);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      // Invalidate the latest request, including manual refreshes after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++request.current;
    };
  }, [refresh]);
  useLiveSync(refresh);

  return {
    files,
    folders,
    loading,
    error,
    refresh,
    upload: async (file: File, tool?: string, folderId?: string | null) => {
      await uploadUserFile(file, tool, folderId);
      await refresh();
    },
    remove: async (f: SavedFile) => {
      const current = fileWorkspace();
      try {
        await deleteFile(f);
      } catch (cause) {
        // Metadata may already be removed even though byte cleanup failed.
        // Show the current ledger without turning that failure into success.
        current();
        await refresh();
        throw cause;
      }
      current();
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
    },
    rename: async (f: SavedFile, newName: string) => {
      const finalName = await renameFile(f, newName);
      await refresh();
      return finalName;
    },
    createFolder: async (name: string, parentId: string | null) => {
      await createFolder(name, parentId);
      await refresh();
    },
    renameFolder: async (id: string, name: string) => {
      await renameFolder(id, name);
      await refresh();
    },
    deleteFolder: async (id: string) => {
      await deleteFolder(id);
      await refresh();
    },
    moveFile: async (fileId: string, folderId: string | null) => {
      await moveFile(fileId, folderId);
      await refresh();
    },
    moveFolder: async (id: string, parentId: string | null) => {
      await moveFolder(id, parentId);
      await refresh();
    },
  };
}
