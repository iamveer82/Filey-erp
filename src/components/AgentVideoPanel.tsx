import { useEffect, useId, useRef, useState } from "react";
import { Film, ArrowUpRight, ImagePlus, X, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { FileySpinner } from "./FileySpinner";
import { creditPaper, invalidateCreditStatus } from "../lib/aiCredits";
import {
  getVideo,
  listVideos,
  quoteVideo,
  startVideo,
  cancelVideo,
  openVideoFile,
  videoActive,
  type VideoJob,
} from "../lib/aiVideo";

const stateLabels: Record<VideoJob["state"], string> = {
  draft: "Ready to generate",
  submitting: "Submitting",
  uncertain: "Checking submission",
  queued: "In the queue",
  in_progress: "Rendering",
  completed: "Your video is ready",
  failed: "Could not finish",
  nsfw: "Request declined",
  canceled: "Canceled",
};

/** A persistent job, not a chat request: closing Filey never resubmits it. */
export function VideoJobCard({ id, initial }: { id: string; initial?: VideoJob }) {
  const [job, setJob] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const state = job?.state;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(refresh, 30000);
        return;
      }
      let again = true;
      try {
        const next = await getVideo(id);
        if (stopped) return;
        setJob(next);
        setError("");
        again = videoActive(next);
        if (!again && next.state !== "draft") invalidateCreditStatus();
      } catch (e) {
        if (!stopped)
          setError(e instanceof Error ? e.message : "Could not refresh this video.");
      }
      if (!stopped && again) timer = setTimeout(refresh, 30000);
    };
    if (!state || ["submitting", "uncertain", "queued", "in_progress"].includes(state)) void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, state]);
  async function act(action: "start" | "cancel" | "refresh") {
    if (!job || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result =
        action === "start"
          ? { job: await startVideo(job) }
          : action === "cancel"
            ? await cancelVideo(id)
            : { job: await getVideo(id) };
      if (mounted.current) {
        setJob(result.job);
        setNotice("message" in result ? (result.message ?? "") : "");
      }
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "Could not update this video.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if (!job)
    return (
      <div className="w-full rounded-2xl border border-border p-4" role="status">
        {error || (
          <span className="flex items-center gap-2 text-sm">
            <FileySpinner />
            Loading video…
          </span>
        )}
      </div>
    );
  const expired = job.state === "draft" && Date.parse(job.quote_expires_at) <= Date.now();
  const active = videoActive(job);
  const noCharge = ["failed", "nsfw", "canceled"].includes(job.state);
  return (
    <article
      className="w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card"
      aria-label="Brand video"
    >
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            {active || busy ? (
              <FileySpinner size={16} />
            ) : job.state === "completed" ? (
              <Check size={16} />
            ) : (
              <Film size={16} />
            )}
            <span role="status">
              {expired ? "Quote expired" : stateLabels[job.state]}
            </span>
          </div>
          <span className="shrink-0 text-sm tabular-nums">
            {creditPaper(
              job.state === "completed" || noCharge
                ? job.charged_micros
                : job.charge_micros
            )}
            {active ? " held" : ""}
          </span>
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {job.prompt}
        </p>
        <p className="text-xs text-muted-foreground">
          Seedance 2.0 · {job.duration}s · 720p ·{" "}
          {job.has_reference ? "Photo framing" : job.aspect_ratio} ·{" "}
          {job.generate_audio ? "With audio" : "Silent"}
        </p>
        {job.state === "draft" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {expired
              ? "Request a new quote in Videos to continue."
              : `${creditPaper(job.charge_micros)} will be held from your Paper wallet. Charged only when the video completes. Failed requests release the hold.`}
          </p>
        )}
        {active && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            You can leave this chat. Reopen Videos to check the result. Stopping chat does
            not cancel a video.
          </p>
        )}
        {job.state === "completed" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {creditPaper(job.charged_micros)} charged. Download the MP4 to keep it; the
            provider keeps outputs for at least 7 days.
          </p>
        )}
        {noCharge && (
          <p className="text-xs text-muted-foreground">
            No Paper charged. Any hold for this video has been released.
          </p>
        )}
        {(job.error || error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || job.error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {job.state === "draft" && !expired && (
            <button
              type="button"
              disabled={busy}
              className="btn-primary"
              onClick={() => void act("start")}
            >
              {busy ? <FileySpinner size={15} /> : <Film size={15} />}Generate ·{" "}
              {creditPaper(job.charge_micros)}
            </button>
          )}
          {["draft", "queued"].includes(job.state) && (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void act("cancel")}
            >
              {job.state === "draft" ? "Discard" : "Cancel queued video"}
            </button>
          )}
          {error && (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void act("refresh")}
            >
              Refresh status
            </button>
          )}
          {job.state === "completed" && job.output_url && (
            <>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setPreview((v) => !v)}
              >
                {preview ? "Hide preview" : "Play video"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  void openVideoFile(job.output_url!).catch((e) => setError(String(e)))
                }
              >
                Open MP4 <ArrowUpRight size={14} />
              </button>
            </>
          )}
          {job.state === "draft" && (
            <Link className="btn-ghost" to="/settings?section=credits">
              Balance & limits
            </Link>
          )}
        </div>
        {preview && job.output_url && (
          <video
            className="max-h-[420px] w-full rounded-xl bg-black"
            controls
            playsInline
            preload="metadata"
            src={job.output_url}
            aria-label="Generated brand video"
            onError={() =>
              setError(
                "The preview could not load. Open the MP4 to download it; older links may have expired."
              )
            }
          />
        )}
      </div>
    </article>
  );
}

export default function AgentVideoPanel({ onClose }: { onClose: () => void }) {
  const formId = useId();
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(4);
  const [aspect, setAspect] = useState("9:16");
  const [audio, setAudio] = useState(true);
  const [file, setFile] = useState<File>();
  const [image, setImage] = useState("");
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);
  const mounted = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    void listVideos()
      .then((result) => {
        if (mounted.current) {
          setJobs(result.jobs);
          setConfigured(result.configured);
        }
      })
      .catch((e) => {
        if (mounted.current)
          setError(e instanceof Error ? e.message : "Could not load your videos.");
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const url = file ? URL.createObjectURL(file) : "";
    setImage(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);
  async function quote(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const job = await quoteVideo(
        { prompt, duration, aspect_ratio: aspect, generate_audio: audio },
        file
      );
      if (mounted.current) setJobs((list) => [job, ...list].slice(0, 30));
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "Could not prepare this video.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section
      id="filey-video-panel"
      aria-label="Create brand videos"
      className="mx-auto mb-6 w-full max-w-3xl rounded-3xl border border-border bg-card p-4 sm:p-6"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Film size={18} /> Brand videos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            From an idea to a short film. 0.25 Paper ($0.25) per second.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost w-10 !px-0"
          onClick={onClose}
          aria-label="Close videos"
        >
          <X size={16} />
        </button>
      </div>
      <form onSubmit={quote} className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor={`${formId}-prompt`}>
            Describe your video
          </label>
          <textarea
            id={`${formId}-prompt`}
            className="input min-h-28 w-full resize-y"
            maxLength={4000}
            required
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A slow close-up of our coffee packaging, warm morning light, steam rising. End on the brand name."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-2 text-sm">
            <span className="block font-medium">Length</span>
            <select
              className="input w-full"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {[4, 5, 6, 8, 10, 12, 15].map((v) => (
                <option key={v} value={v}>
                  {v} seconds
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="block font-medium">Format</span>
            <select
              className="input w-full"
              value={aspect}
              disabled={!!file}
              onChange={(e) => setAspect(e.target.value)}
            >
              <option value="9:16">Portrait · 9:16</option>
              <option value="16:9">Landscape · 16:9</option>
              <option value="1:1">Square · 1:1</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Reference photo"
            onChange={(e) => {
              const next = e.target.files?.[0];
              if (
                next &&
                (next.size > 2_000_000 ||
                  !["image/png", "image/jpeg", "image/webp"].includes(next.type))
              )
                setError("Use a JPG, PNG or WebP image under 2 MB.");
              else {
                setFile(next);
                setError("");
              }
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn-ghost"
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus size={15} />
            {file ? "Change photo" : "Add product photo"}
          </button>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={audio}
              onChange={(e) => setAudio(e.target.checked)}
              className="accent-primary"
            />
            Generate audio
          </label>
        </div>
        {file && (
          <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
            <img
              src={image}
              alt="Video starting frame"
              className="h-14 w-14 rounded-lg object-cover"
            />
            <div className="min-w-0 flex-1 text-xs">
              <p className="truncate font-medium">{file.name}</p>
              <p className="mt-1 text-muted-foreground">
                The video uses this photo’s framing. Uploaded to Higgsfield when you
                request a quote.
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost w-10 !px-0"
              aria-label="Remove reference photo"
              onClick={() => setFile(undefined)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {!configured && (
          <p className="text-sm text-muted-foreground">
            Video generation is being connected. Your previous videos remain available
            below.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !configured || !prompt.trim()}
          >
            {busy && <FileySpinner size={15} />}Review video ·{" "}
            {creditPaper(duration * 250000)}
          </button>
          <span className="text-xs text-muted-foreground">
            Seedance 2.0 · 720p · No charge for a quote
          </span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Available on every plan using your Paper balance. Your task and daily
          spending limits apply. Video generation is separate from chat’s free models or
          your own API key.
        </p>
      </form>
      <div className="mt-6 space-y-3 border-t border-border pt-5">
        <h3 className="text-sm font-medium">Recent videos</h3>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileySpinner size={15} />
            Loading videos…
          </p>
        ) : !jobs.length ? (
          <p className="text-sm text-muted-foreground">
            Your drafts and finished videos will stay here when you return.
          </p>
        ) : (
          jobs.map((job) => <VideoJobCard key={job.id} id={job.id} initial={job} />)
        )}
      </div>
    </section>
  );
}
