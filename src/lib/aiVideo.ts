import { callAiService, invalidateCreditStatus } from "./aiCredits";
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
export async function quoteVideo(_draft: VideoDraft, _file?: File): Promise<VideoJob> {
  throw new Error("Videos use your own API key. Set up Video generation in AI settings. Coin is not used for videos.");
}
export const listVideos = () =>
  request<{ jobs: VideoJob[]; configured: boolean }>({ action: "list" });
export const getVideo = async (id: string) =>
  (await request<{ job: VideoJob }>({ action: "get", id })).job;
export async function startVideo(_job: VideoJob): Promise<VideoJob> {
  throw new Error("This older draft cannot be generated with Coin. Create a new video using your own API key.");
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
  const { isNativeApp, openNativeExternal } = await import("./nativePlatform");
  if (isNativeApp()) await openNativeExternal(value.href);
  else if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(value.href);
  } else window.open(value.href, "_blank", "noopener,noreferrer");
}
