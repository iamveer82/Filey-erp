// Persisted tool outputs in Supabase Storage. Files live in the
// private "tool-outputs" bucket under {uid}/{runId}/ and stay until the
// user deletes the run. RLS on storage.objects scopes every object to
// its owner (see supabase/schema.sql).
import { sb, isConfigured } from "./supabase";

export const TOOL_BUCKET = "tool-outputs";

/** Per-user storage quota for processed tool outputs. */
export const STORAGE_QUOTA_BYTES = 100 * 1024 * 1024; // 100 MB

const guessType = (name: string): string => {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (/\.png$/.test(n)) return "image/png";
  if (/\.jpe?g$/.test(n)) return "image/jpeg";
  if (/\.webp$/.test(n)) return "image/webp";
  if (/\.bmp$/.test(n)) return "image/bmp";
  if (/\.svg$/.test(n)) return "image/svg+xml";
  if (/\.json$/.test(n)) return "application/json";
  if (/\.csv$/.test(n)) return "text/csv";
  if (/\.(txt|md|log)$/.test(n)) return "text/plain";
  return "application/octet-stream";
};

const sanitize = (name: string) =>
  name.replace(/[^\w.\-]+/g, "_").slice(0, 80);

async function uid(): Promise<string | null> {
  try {
    const { data } = await sb().auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Upload a run's outputs; returns the stored object paths. */
export async function uploadOutputs(
  runId: number,
  files: { name: string; bytes: Uint8Array }[]
): Promise<string[]> {
  if (!isConfigured || runId <= 0 || !files.length) return [];
  const id = await uid();
  if (!id) return [];
  const paths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const type = guessType(f.name);
    const path = `${id}/${runId}/${i}_${sanitize(f.name)}`;
    const blob = new Blob([f.bytes.slice()], { type });
    const { error } = await sb()
      .storage.from(TOOL_BUCKET)
      .upload(path, blob, { upsert: true, contentType: type });
    if (!error) paths.push(path);
  }
  return paths;
}

/** Short-lived signed URL for a stored object. */
export async function signedUrl(
  path: string,
  expiresSec = 3600
): Promise<string | null> {
  if (!isConfigured) return null;
  const { data, error } = await sb()
    .storage.from(TOOL_BUCKET)
    .createSignedUrl(path, expiresSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Download an object's bytes (for client-side rendering). */
export async function downloadBytes(
  path: string
): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!isConfigured) return null;
  const { data, error } = await sb()
    .storage.from(TOOL_BUCKET)
    .download(path);
  if (error || !data) return null;
  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    type: data.type || "application/octet-stream",
  };
}

/** Remove stored objects (used when a run is deleted). */
export async function removePaths(paths: string[]): Promise<void> {
  if (!isConfigured || !paths.length) return;
  try {
    await sb().storage.from(TOOL_BUCKET).remove(paths);
  } catch {
    /* best-effort */
  }
}

/** Total bytes the current user has stored. */
export async function usedBytes(): Promise<number> {
  if (!isConfigured) return 0;
  try {
    const { data } = await sb().from("tool_runs").select("size_bytes");
    return (data ?? []).reduce(
      (s: number, r: any) => s + Number(r.size_bytes || 0),
      0
    );
  } catch {
    return 0;
  }
}

/** Evict oldest stored runs until `incoming` bytes fit under the quota.
 *  Returns true when there is room (false only if a single run exceeds it). */
export async function ensureRoom(incoming: number): Promise<boolean> {
  if (!isConfigured) return true;
  if (incoming > STORAGE_QUOTA_BYTES) return false;
  try {
    const { data } = await sb()
      .from("tool_runs")
      .select("id, size_bytes, storage_paths")
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as {
      id: number;
      size_bytes: number;
      storage_paths: string[] | null;
    }[];
    let total = rows.reduce((s, r) => s + Number(r.size_bytes || 0), 0);
    for (const r of rows) {
      if (total + incoming <= STORAGE_QUOTA_BYTES) break;
      if (!r.storage_paths?.length) continue; // nothing stored to reclaim
      await removePaths(r.storage_paths);
      await sb().from("tool_runs").delete().eq("id", r.id);
      total -= Number(r.size_bytes || 0);
    }
    return total + incoming <= STORAGE_QUOTA_BYTES;
  } catch {
    return true; // never block processing on a quota check failure
  }
}

export const fileNameOf = (path: string) =>
  (path.split("/").pop() ?? path).replace(/^\d+_/, "");
