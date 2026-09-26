import { useEffect, useId, useState } from "react";
import { ImageIcon, Film, X, Download, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { FileySpinner } from "./FileySpinner";
import AgentVideoPanel from "./AgentVideoPanel";
import {
  MEDIA_EVENT,
  MEDIA_MODELS,
  createMediaDraft,
  getMediaConfig,
  getMediaJob,
  listMediaJobs,
  startMedia,
  refreshMedia,
  cancelMedia,
  mediaActive,
  safeMediaUrl,
  type MediaJob,
  type MediaKind,
} from "../lib/aiMedia";
import { agentStorageScope, requireAgentStorageScope } from "../lib/agentStorage";
import { mediaBlob } from "../lib/aiMediaStore";
import { downloadMedia, saveMediaFile } from "../lib/mediaDownload";
import { openVideoFile } from "../lib/aiVideo";

const labels: Record<MediaJob["state"], string> = {
  draft: "Ready to generate",
  submitting: "Submitting",
  uncertain: "Check provider history",
  queued: "In the queue",
  in_progress: "Generating",
  completed: "Ready",
  failed: "Could not finish",
  canceled: "Discarded",
};
export function MediaJobCard({ id }: { id: string }) {
  const [job, setJob] = useState<MediaJob>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const state = job?.state;
  useEffect(() => {
    const update = () => {
      try {
        setJob(getMediaJob(id));
      } catch (e) {
        setError(String(e));
      }
    };
    update();
    window.addEventListener(MEDIA_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(MEDIA_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [id]);
  useEffect(() => {
    if (!state || !["queued", "in_progress"].includes(state)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const next = await refreshMedia(id);
          if (stopped) return;
          setJob(next);
          setError("");
          if (!mediaActive(next)) return;
        } catch (e) {
          if (!stopped) {
            setError(e instanceof Error ? e.message : "Could not refresh media.");
            return;
          }
        }
      }
      if (!stopped) timer = setTimeout(poll, 15000);
    };
    timer = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, state]);
  useEffect(() => {
    let stopped = false,
      url = "";
    setPreview("");
    if (job?.blob)
      void mediaBlob(id, requireAgentStorageScope())
        .then((blob) => {
          if (stopped) return;
          if (!blob) {
            setError("The image is no longer stored on this device.");
            return;
          }
          url = URL.createObjectURL(blob);
          setPreview(url);
        })
        .catch((e) => {
          if (!stopped) setError(String(e));
        });
    else if (job?.outputUrl) {
      try {
        setPreview(safeMediaUrl(job.outputUrl));
      } catch {
        setError("Invalid media output link.");
      }
    }
    return () => {
      stopped = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, job?.blob, job?.outputUrl]);
  async function act(action: "start" | "refresh" | "discard" | "download") {
    const scope = agentStorageScope();
    if (!scope || busy || !job) return;
    setBusy(true);
    setError("");
    try {
      if (action === "download") {
        const response =
          !job.blob && job.outputUrl
            ? await downloadMedia(job.outputUrl, AbortSignal.timeout(60000))
            : undefined;
        if (response && !response.ok)
          throw new Error("The provider download link is unavailable or expired.");
        const blob = job.blob ? await mediaBlob(id, scope) : await response?.blob();
        if (!blob || !blob.size)
          throw new Error(
            "This image could not be downloaded. Try opening the original."
          );
        requireAgentStorageScope(scope);
        const extension = blob.type.includes("jpeg")
          ? "jpg"
          : blob.type.includes("webp")
            ? "webp"
            : "png";
        await saveMediaFile(blob, `filey-image-${id.slice(-8)}.${extension}`);
      } else {
        const next =
          action === "start"
            ? await startMedia(id)
            : action === "discard"
              ? await cancelMedia(id)
              : await refreshMedia(id);
        if (scope === agentStorageScope()) setJob(next);
      }
    } catch (e) {
      if (scope === agentStorageScope())
        setError(e instanceof Error ? e.message : "Could not update media.");
    } finally {
      if (scope === agentStorageScope()) setBusy(false);
    }
  }
  if (!job)
    return (
      <div role="status" className="w-full rounded-xl border border-border p-4 text-sm">
        {error || "Loading media…"}
      </div>
    );
  const active = mediaActive(job) || job.state === "submitting";
  return (
    <article
      aria-label={`Generated ${job.kind}`}
      className="w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card"
    >
      {preview &&
        (job.kind === "video" ? (
          <video
            controls
            playsInline
            preload="metadata"
            src={preview}
            aria-label="Generated video"
            className="max-h-[480px] w-full bg-black"
            onError={() =>
              setError(
                "The video could not load. Open the original; provider links may expire."
              )
            }
          />
        ) : (
          <img
            src={preview}
            alt={job.prompt}
            className="max-h-[480px] w-full object-contain"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() =>
              setError(
                "The image could not load. Provider links may expire; try opening the original."
              )
            }
          />
        ))}
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
          <span className="flex items-center gap-2" role="status">
            {active || busy ? (
              <FileySpinner size={16} />
            ) : job.kind === "image" ? (
              <ImageIcon size={16} />
            ) : (
              <Film size={16} />
            )}
            {labels[job.state]}
          </span>
          <span className="text-xs text-muted-foreground">Your API key</span>
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
          {job.prompt}
        </p>
        <p className="break-words text-xs text-muted-foreground">
          {MEDIA_MODELS.find((model) => model.id === job.model)?.label ?? job.model}
          {job.kind === "video" ? ` · ~${job.duration}s · 720p · silent` : ""}
        </p>
        {job.state === "draft" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Your provider’s current rates apply. Generate submits one request using your{" "}
            {job.kind} key. No Filey credits will be deducted.
          </p>
        )}
        {active && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Results will appear here. Reopen this chat on this device to check progress;
            browser users may need to enter their key again.
          </p>
        )}
        {job.state === "completed" && (
          <p className="text-xs text-muted-foreground">
            {job.blob
              ? "Saved in this chat on this device."
              : "Download a copy to keep it. Provider links can expire."}
          </p>
        )}
        {(error || job.error) && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error || job.error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {job.state === "draft" && (
            <>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void act("start")}
              >
                Generate {job.kind}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => void act("discard")}
              >
                Discard
              </button>
            </>
          )}
          {job.state === "completed" && job.kind === "image" && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void act("download")}
            >
              <Download size={14} />
              Download image
            </button>
          )}
          {job.state === "completed" && job.outputUrl && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                void openVideoFile(job.outputUrl!).catch((e) => setError(String(e)))
              }
            >
              Open {job.kind === "video" ? "MP4" : "original"}
              <ArrowUpRight size={14} />
            </button>
          )}
          {error && mediaActive(job) && (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void act("refresh")}
            >
              Check again
            </button>
          )}
          {job.state !== "completed" && (
            <Link to="/settings?section=ai" className="btn-ghost">
              Media settings
            </Link>
          )}
          {(job.state === "uncertain" || job.state === "failed") &&
            job.provider === "fal" && (
              <a
                href="https://fal.ai/dashboard/requests"
                className="btn-ghost"
                target="_blank"
                rel="noopener noreferrer"
              >
                Provider history
                <ArrowUpRight size={14} />
              </a>
            )}
        </div>
      </div>
    </article>
  );
}

export default function AgentMediaPanel({
  onClose,
  onDraft,
}: {
  onClose: () => void;
  onDraft: (job: MediaJob) => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<MediaKind>("image");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [duration, setDuration] = useState(5);
  const [reference, setReference] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creditVideos, setCreditVideos] = useState(false);
  const [recent, setRecent] = useState(listMediaJobs);
  const [scope] = useState(agentStorageScope);
  const config = getMediaConfig();
  useEffect(() => {
    const refresh = () => setRecent(listMediaJobs());
    window.addEventListener(MEDIA_EVENT, refresh);
    return () => window.removeEventListener(MEDIA_EVENT, refresh);
  }, []);
  async function draft() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const job = await createMediaDraft(kind, prompt, {
        aspect,
        duration,
        reference: kind === "video" ? reference : undefined,
      });
      if (scope !== agentStorageScope()) return;
      onDraft(job);
    } catch (e) {
      if (scope === agentStorageScope())
        setError(e instanceof Error ? e.message : "Could not prepare media.");
    } finally {
      if (scope === agentStorageScope()) setBusy(false);
    }
  }
  if (creditVideos)
    return (
      <>
        <button
          className="btn-ghost mb-3"
          type="button"
          onClick={() => setCreditVideos(false)}
        >
          Back to your media models
        </button>
        <AgentVideoPanel onClose={onClose} />
      </>
    );
  return (
    <section
      id="filey-media-panel"
      aria-label="Create images and videos"
      className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-6"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Create with Filey</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Images and videos, right in your conversation.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost w-10 shrink-0 !px-0"
          aria-label="Close media"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void draft();
        }}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="flex gap-2" role="group" aria-label="Media type">
            {(["image", "video"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={kind === value ? "btn-primary" : "btn-ghost"}
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);
                  setError("");
                }}
              >
                {value === "image" ? <ImageIcon size={15} /> : <Film size={15} />}
                {value === "image" ? "Image" : "Video"}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-prompt`} className="label">
              Describe your {kind}
            </label>
            <textarea
              id={`${id}-prompt`}
              className="input min-h-28 resize-y"
              required
              maxLength={4000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                kind === "image"
                  ? "A product photo for our new coffee blend, on a warm cream background…"
                  : "A slow camera move around our coffee bag, with warm morning light…"
              }
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {(kind === "video" || config.imageProvider === "fal") && (
              <div className="space-y-2">
                <label htmlFor={`${id}-aspect`} className="label">
                  Framing
                </label>
                <select
                  id={`${id}-aspect`}
                  className="input"
                  value={aspect}
                  onChange={(e) => setAspect(e.target.value)}
                >
                  <option value="9:16">Portrait · 9:16</option>
                  <option value="16:9">Landscape · 16:9</option>
                  <option value="1:1">Square · 1:1</option>
                </select>
              </div>
            )}
            {kind === "video" && (
              <div className="space-y-2">
                <label htmlFor={`${id}-duration`} className="label">
                  Length
                </label>
                <select
                  id={`${id}-duration`}
                  className="input"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  <option value={5}>About 5 seconds</option>
                  <option value={10}>About 10 seconds</option>
                </select>
              </div>
            )}
          </div>
          {kind === "video" && (
            <div className="space-y-2">
              <label htmlFor={`${id}-photo`} className="label">
                Product photo · optional
              </label>
              <input
                id={`${id}-photo`}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="input w-full text-sm"
                onChange={(e) => setReference(e.target.files?.[0])}
              />
              <p className="text-xs text-muted-foreground">
                JPG, PNG or WebP up to 2 MB. Videos use Wan 2.2 and have no audio.
              </p>
            </div>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={busy || !prompt.trim()}>
            {busy && <FileySpinner size={15} />}Review in chat
          </button>
          <Link className="btn-ghost" to="/settings?section=ai">
            Set up media models
          </Link>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Reviewing is free. Generation uses your provider’s API key and rates, separately
          from your chat model.
        </p>
      </form>
      {recent.length > 0 && (
        <details className="mt-5 border-t border-border pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            Recent media on this device
          </summary>
          <div className="mt-3 space-y-2">
            {recent.slice(0, 10).map((job) => (
              <button
                key={job.id}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-hover"
                onClick={() => onDraft(job)}
              >
                {job.kind === "image" ? (
                  <ImageIcon size={16} className="shrink-0" />
                ) : (
                  <Film size={16} className="shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{job.prompt}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {labels[job.state]}
                </span>
              </button>
            ))}
          </div>
        </details>
      )}
      <button
        type="button"
        className="btn-ghost mt-4 text-xs"
        onClick={() => setCreditVideos(true)}
      >
        Filey credit video requests
      </button>
    </section>
  );
}
