import { supabase } from "./supabase";
import { assertWorkspaceCurrent, isLocalMode } from "./dataMode";

export interface TeamAttachment {
  path: string;
  name: string;
  mime: string;
  size: number;
}
export const TEAM_ATTACHMENT_BUCKET = "team-attachments";
const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const TEAM_ATTACHMENT_ACCEPT = Object.keys(TYPES)
  .map((ext) => `.${ext}`)
  .join(",");
export function validateTeamAttachments(files: File[]): string[] {
  if (files.length > 5) throw new Error("Choose up to 5 files per message.");
  return files.map((file) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const mime = TYPES[ext];
    // Mobile pickers sometimes supply no MIME; CSV is also reported as Excel.
    if (
      !mime ||
      (file.type &&
        file.type !== mime &&
        !(ext === "csv" && file.type === "application/vnd.ms-excel"))
    )
      throw new Error("Choose images, PDF, Word, Excel, PowerPoint, CSV or text files.");
    if (!file.size || file.size > 10 * 1024 * 1024)
      throw new Error("Each file must be between 1 byte and 10 MB.");
    return mime;
  });
}

/** Complete the message only after all files upload; never publish partial sends. */
export async function withTeamAttachments(
  files: File[],
  send: (attachments: TeamAttachment[]) => Promise<void>,
  check: () => void
): Promise<void> {
  const mimes = validateTeamAttachments(files);
  if (!supabase || isLocalMode())
    throw new Error("Open a cloud workspace to share files with your team.");
  const client = supabase;
  const { data: session, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session.session)
    throw new Error("Sign in to share files with your team.");
  const uid = session.session.user.id;
  const { data: profile, error } = await client
    .from("profiles")
    .select("org_id")
    .eq("id", uid)
    .single();
  if (error || !profile?.org_id)
    throw new Error("Your workspace could not be loaded. Please try again.");
  const uploaded: TeamAttachment[] = [];
  try {
    for (const [index, file] of files.entries()) {
      check();
      const path = `${profile.org_id}/${uid}/${crypto.randomUUID()}.${file.name.split(".").pop()!.toLowerCase()}`;
      // Keep the attempted path for cleanup even if the upload response is lost.
      uploaded.push({
        path,
        name: file.name.slice(0, 240),
        mime: mimes[index],
        size: file.size,
      });
      const { error } = await client.storage
        .from(TEAM_ATTACHMENT_BUCKET)
        .upload(path, file, { contentType: mimes[index], upsert: false });
      if (error)
        throw new Error(
          "A file could not be uploaded. Your message is still here; please try again."
        );
    }
    check();
    await send(uploaded);
  } catch (error) {
    // Storage refuses deletion if a message committed before its response was lost.
    if (uploaded.length)
      await client.storage
        .from(TEAM_ATTACHMENT_BUCKET)
        .remove(uploaded.map((a) => a.path))
        .catch(() => {});
    throw error;
  }
}

export async function readTeamAttachment(attachment: TeamAttachment): Promise<Blob> {
  assertWorkspaceCurrent();
  if (!supabase || isLocalMode())
    throw new Error("Open the cloud workspace to view this attachment.");
  const { data, error } = await supabase.storage
    .from(TEAM_ATTACHMENT_BUCKET)
    .download(attachment.path);
  assertWorkspaceCurrent();
  if (error || !data)
    throw new Error(
      "This file is unavailable or you no longer have access. Please try again."
    );
  return data;
}
