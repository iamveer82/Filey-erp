import { aiFetch, AiError } from "./ai";
import { generateImage, getImageConfig, resolveImageEndpoint } from "./aiImage";
import { getCacheScope } from "./api";
import { hasCredential, readCredential, saveCredential } from "./credentialStore";
import {
  agentStorageKey,
  readAgentStorage,
  requireAgentStorageScope,
  writeAgentStorage,
} from "./agentStorage";
import { mediaBlob } from "./aiMediaStore";

export type MediaKind = "image" | "video";
export const MEDIA_EVENT = "filey:media";
const running = new Map<string, Promise<MediaJob>>();
export const MEDIA_MODELS = [
  { id: "fal-ai/flux/schnell", label: "FLUX Schnell", kind: "image" },
  { id: "fal-ai/flux/dev", label: "FLUX Dev", kind: "image" },
  { id: "fal-ai/wan/v2.2-a14b/text-to-video", label: "Wan 2.2", kind: "video" },
] as const;
export interface MediaConfig {
  imageProvider: "openai" | "fal";
  imageModel: string;
  videoModel: string;
  videoSource: "byok" | "credits";
}
const DEFAULTS: MediaConfig = {
  imageProvider: "openai",
  imageModel: MEDIA_MODELS[0].id,
  videoModel: MEDIA_MODELS[2].id,
  videoSource: "byok",
};
export const mediaCredential = (kind: MediaKind) => `media:fal:${kind}`;
export function getMediaConfig(): MediaConfig {
  try {
    return {
      ...DEFAULTS,
      ...JSON.parse(readAgentStorage("filey.ai.media.config") ?? "{}"),
    };
  } catch {
    return { ...DEFAULTS };
  }
}
export async function saveMediaConfig(
  config: MediaConfig,
  kind: MediaKind,
  key: string | undefined,
  scope: string
) {
  requireAgentStorageScope(scope);
  if (key !== undefined) await saveCredential(mediaCredential(kind), key.trim() || null);
  requireAgentStorageScope(scope);
  writeAgentStorage("filey.ai.media.config", JSON.stringify(config), scope);
  window.dispatchEvent(new Event(MEDIA_EVENT));
}
export interface MediaJob {
  id: string;
  kind: MediaKind;
  provider: "fal" | "openai";
  model: string;
  baseUrl?: string;
  size?: string;
  prompt: string;
  aspect: string;
  duration: number;
  reference: boolean;
  state:
    | "draft"
    | "submitting"
    | "uncertain"
    | "queued"
    | "in_progress"
    | "completed"
    | "failed"
    | "canceled";
  createdAt: number;
  requestId?: string;
  outputUrl?: string;
  blob?: boolean;
  error?: string;
}
const keyFor = (id: string) => {
  if (!/^media-[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid media job.");
  return `filey.ai.media.job.${id}`;
};
export function getMediaJob(id: string): MediaJob {
  const value = readAgentStorage(keyFor(id));
  if (!value)
    throw new Error(
      "This media request is not saved in the current workspace on this device."
    );
  const job = JSON.parse(value) as MediaJob;
  if (job.state === "submitting" && !running.has(`${requireAgentStorageScope()}:${id}`))
    return {
      ...job,
      state: "uncertain",
      error:
        "Submission was interrupted. Check your provider's request history before creating another request. Filey will not resubmit it.",
    };
  return job;
}
function persist(job: MediaJob, scope: string) {
  writeAgentStorage(keyFor(job.id), JSON.stringify(job), scope);
  window.dispatchEvent(new CustomEvent(MEDIA_EVENT, { detail: { id: job.id } }));
  return job;
}
export function listMediaJobs() {
  const suffix = agentStorageKey("scope")?.slice(5);
  if (!suffix) return [];
  return Object.keys(localStorage)
    .filter((k) => k.startsWith("filey.ai.media.job.") && k.endsWith(suffix))
    .flatMap((k) => {
      try {
        return [getMediaJob(JSON.parse(localStorage.getItem(k)!).id)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30);
}
export const mediaActive = (job: MediaJob) =>
  ["queued", "in_progress"].includes(job.state);
export async function createMediaDraft(
  kind: MediaKind,
  prompt: string,
  options: { aspect?: string; duration?: number; reference?: File; size?: string } = {}
) {
  const scope = requireAgentStorageScope();
  const config = getMediaConfig();
  const provider = kind === "video" ? "fal" : config.imageProvider;
  const text = prompt.trim();
  if (!text || text.length > 4000)
    throw new Error("Describe your media in 1–4,000 characters.");
  const aspect = options.aspect ?? "9:16";
  const duration = options.duration ?? 5;
  if (!["9:16", "16:9", "1:1"].includes(aspect))
    throw new Error("Choose portrait, landscape or square framing.");
  if (kind === "video" && ![5, 10].includes(duration))
    throw new Error("Wan videos support approximately 5 or 10 seconds.");
  const endpoint = resolveImageEndpoint();
  const model =
    provider === "openai"
      ? endpoint.model
      : kind === "image"
        ? config.imageModel
        : config.videoModel;
  if (provider === "fal" && !MEDIA_MODELS.some((m) => m.id === model && m.kind === kind))
    throw new Error("Choose a supported media model in AI settings.");
  if (provider === "fal" && !hasCredential(mediaCredential(kind)))
    throw new Error(
      `Add your ${kind} API key in Settings → AI → ${kind === "image" ? "Image" : "Video"} generation.`
    );
  if (provider === "openai" && !endpoint.usable)
    throw new Error(endpoint.why || "Configure your image model in AI settings.");
  const job: MediaJob = {
    id: `media-${crypto.randomUUID()}`,
    kind,
    provider,
    model,
    prompt: text,
    aspect,
    duration,
    reference: !!options.reference,
    state: "draft",
    createdAt: Date.now(),
    ...(provider === "openai"
      ? { baseUrl: endpoint.baseUrl, size: options.size || getImageConfig().size }
      : {}),
  };
  if (options.reference) {
    const file = options.reference;
    if (
      kind !== "video" ||
      file.size > 2_000_000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    )
      throw new Error("Use a JPG, PNG or WebP photo under 2 MB for a video.");
    await mediaBlob(`${job.id}-reference`, scope, file);
  }
  return persist(job, scope);
}

function modelEndpoint(job: MediaJob) {
  if (!MEDIA_MODELS.some((m) => m.id === job.model && m.kind === job.kind))
    throw new Error("Unsupported media model.");
  return job.reference ? job.model.replace("text-to-video", "image-to-video") : job.model;
}
function queueUrl(job: MediaJob, action: "status" | "result" | "cancel") {
  if (!job.requestId || !/^[a-zA-Z0-9_-]{1,150}$/.test(job.requestId))
    throw new Error(
      "The provider did not return a usable request ID. Check its dashboard before trying again."
    );
  const root = modelEndpoint(job).split("/").slice(0, 2).join("/");
  return `https://queue.fal.run/${root}/requests/${job.requestId}${action === "result" ? "" : `/${action}`}`;
}
export function safeMediaUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes(".") ||
    /^(?:\d+\.){3}\d+$/.test(url.hostname) ||
    /(^|\.)(localhost|local|internal)$/.test(url.hostname)
  )
    throw new Error("Invalid media link from provider.");
  return url.href;
}
async function fal(job: MediaJob, url: string, method = "GET", body?: unknown) {
  const owner = getCacheScope();
  if (!owner) throw new Error("Sign in before using media models.");
  const key = await readCredential(mediaCredential(job.kind), owner);
  if (!key)
    throw new Error(
      `Add your ${job.kind} API key again in AI settings to check this request.`
    );
  const response = await aiFetch(
    url,
    {
      method,
      headers: { "content-type": "application/json", authorization: `Key ${key}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    },
    { retries: 0 }
  );
  return await response.json();
}
// Cross-tab lock + durable pre-submit state prevent repeated clicks charging twice.
export function startMedia(id: string): Promise<MediaJob> {
  const scope = requireAgentStorageScope();
  const lock = `${scope}:${id}`;
  const current = running.get(lock);
  if (current) return current;
  const run = () => submit(id, scope);
  const pending = Promise.resolve()
    .then(() => (navigator.locks ? navigator.locks.request(lock, run) : run()))
    .finally(() => running.delete(lock));
  running.set(lock, pending);
  return pending;
}
async function submit(id: string, scope: string) {
  requireAgentStorageScope(scope);
  let job = getMediaJob(id);
  if (job.state !== "draft") return job;
  // Resolve storage/key errors before recording a possibly billable request.
  if (
    job.provider === "fal" &&
    !(await readCredential(mediaCredential(job.kind), getCacheScope()!))
  )
    throw new Error("Add your media API key in AI settings.");
  let reference: string | undefined;
  if (job.reference) {
    const blob = await mediaBlob(`${id}-reference`, scope);
    if (!blob)
      throw new Error(
        "The reference photo is missing. Create a new draft with the photo."
      );
    reference = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read the reference photo."));
      reader.readAsDataURL(blob);
    });
  }
  requireAgentStorageScope(scope);
  job = getMediaJob(id);
  if (job.state !== "draft") return job;
  job = persist({ ...job, state: "submitting", error: undefined }, scope);
  try {
    if (job.provider === "openai") {
      const image = await generateImage(job.prompt, {
        config: { baseUrl: job.baseUrl!, model: job.model, size: job.size! },
      });
      await mediaBlob(id, scope, new Blob([image.bytes.slice()], { type: image.mime }));
      return persist({ ...job, state: "completed", blob: true }, scope);
    }
    const input =
      job.kind === "image"
        ? {
            prompt: job.prompt,
            num_images: 1,
            output_format: "png",
            enable_safety_checker: true,
            image_size:
              job.aspect === "1:1"
                ? "square_hd"
                : job.aspect === "9:16"
                  ? "portrait_16_9"
                  : "landscape_16_9",
          }
        : {
            prompt: job.prompt,
            num_frames: job.duration * 16 + 1,
            frames_per_second: 16,
            resolution: "720p",
            aspect_ratio: job.aspect,
            enable_safety_checker: true,
            enable_output_safety_checker: true,
            ...(reference ? { image_url: reference } : {}),
          };
    const result = await fal(
      job,
      `https://queue.fal.run/${modelEndpoint(job)}`,
      "POST",
      input
    );
    job = { ...job, requestId: result.request_id };
    queueUrl(job, "status"); // never persist an arbitrary provider URL
    return persist({ ...job, state: "queued" }, scope);
  } catch (error) {
    requireAgentStorageScope(scope);
    const definite =
      error instanceof AiError &&
      !!error.status &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408;
    return persist(
      {
        ...job,
        state: definite ? "failed" : "uncertain",
        error: definite
          ? `The provider declined this request (${(error as AiError).status}). Check your key, model access and provider balance.`
          : "Submission could not be confirmed. Check your provider's request history before creating another request; it may already be processing. Filey will not resubmit it.",
      },
      scope
    );
  }
}
const refreshing = new Map<string, Promise<MediaJob>>();
export function refreshMedia(id: string): Promise<MediaJob> {
  const scope = requireAgentStorageScope();
  const key = `${scope}:${id}`;
  const current = refreshing.get(key);
  if (current) return current;
  const pending = refresh(id, scope).finally(() => refreshing.delete(key));
  refreshing.set(key, pending);
  return pending;
}
async function refresh(id: string, scope: string) {
  const job = getMediaJob(id);
  if (!mediaActive(job)) return job;
  const status = await fal(job, queueUrl(job, "status"));
  requireAgentStorageScope(scope);
  if (status.status === "COMPLETED") {
    if (status.error || status.error_type)
      return persist(
        {
          ...job,
          state: "failed",
          error:
            "The provider could not complete this request. Check its request history for details and billing.",
        },
        scope
      );
    const result = await fal(job, queueUrl(job, "result"));
    const output = job.kind === "image" ? result.images?.[0]?.url : result.video?.url;
    if (!output)
      return persist(
        {
          ...job,
          state: "failed",
          error: "The provider returned no usable output. Check its request history.",
        },
        scope
      );
    return persist(
      { ...job, state: "completed", outputUrl: safeMediaUrl(output) },
      scope
    );
  }
  if (!["IN_QUEUE", "IN_PROGRESS"].includes(status.status))
    throw new Error(
      "Unknown provider status. Check the provider dashboard; no new generation has been submitted."
    );
  const state = status.status === "IN_PROGRESS" ? "in_progress" : "queued";
  return state === job.state ? job : persist({ ...job, state }, scope);
}
export async function cancelMedia(id: string) {
  const scope = requireAgentStorageScope();
  const job = getMediaJob(id);
  if (job.state === "draft") return persist({ ...job, state: "canceled" }, scope);
  if (!mediaActive(job)) return job;
  await fal(job, queueUrl(job, "cancel"), "PUT");
  // A successful cancel response is only a request; processing may have won the race.
  return {
    ...job,
    message:
      "Cancellation requested. The provider may still complete the request. Check its request history for final status and charges.",
  };
}
