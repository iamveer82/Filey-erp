import { callAiService, aiAccountSession, invalidateCreditStatus } from "./aiCredits";
import { agentStorageScope } from "./agentStorage";

export interface VideoJob {
  id: string;
  state:
    | "draft"
    | "submitting"
    | "uncertain"
    | "queued"
    | "in_progress"
    | "completed"
    | "failed"
    | "nsfw"
    | "canceled";
  prompt: string;
  duration: number;
  charge_micros: number;
  charged_micros: number;
  aspect_ratio: string;
  generate_audio: boolean;
  has_reference: boolean;
  quote_expires_at: string;
  created_at: string;
  started_at: string | null;
  output_url: string | null;
  error: string | null;
}
export interface VideoDraft {
  prompt: string;
  duration: number;
  aspect_ratio: string;
  generate_audio: boolean;
}
export const videoActive = (job: VideoJob) =>
  ["submitting", "uncertain", "queued", "in_progress"].includes(job.state);
async function request<T>(
  body: Record<string, unknown>,
  expectedUser?: string
): Promise<T> {
  const scope = agentStorageScope();
  const result = await callAiService<T>("ai-video", body, expectedUser);
  if (scope !== agentStorageScope())
    throw new Error("Your workspace changed. Reopen Videos in the current workspace.");
  return result;
}
export async function quoteVideo(draft: VideoDraft, file?: File) {
  const scope = agentStorageScope();
  const user = (await aiAccountSession()).user.id;
  let reference: { type: string; data: string } | undefined;
  if (file) {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 2_000_000
    )
      throw new Error("Use a JPG, PNG or WebP image under 2 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let raw = "";
    for (let i = 0; i < bytes.length; i += 8192)
      raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    reference = { type: file.type, data: btoa(raw) };
  }
  if (scope !== agentStorageScope())
    throw new Error(
      "Your workspace changed. Choose the photo again in the current workspace."
    );
  return (
    await request<{ job: VideoJob }>({ action: "quote", ...draft, reference }, user)
  ).job;
}
export const listVideos = () =>
  request<{ jobs: VideoJob[]; configured: boolean }>({ action: "list" });
export const getVideo = async (id: string) =>
  (await request<{ job: VideoJob }>({ action: "get", id })).job;
export async function startVideo(job: VideoJob) {
  const result = await request<{ job: VideoJob }>({
    action: "start",
    id: job.id,
    charge_micros: job.charge_micros,
  });
  invalidateCreditStatus();
  return result.job;
}
export async function cancelVideo(id: string) {
  const result = await request<{ job: VideoJob; message?: string }>({
    action: "cancel",
    id,
  });
  invalidateCreditStatus();
  return result;
}
export async function openVideoFile(url: string) {
  const value = new URL(url);
  if (value.protocol !== "https:" || value.username || value.password)
    throw new Error("Invalid video file link.");
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(value.href);
  } else window.open(value.href, "_blank", "noopener,noreferrer");
}
