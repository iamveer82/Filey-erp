import { useEffect, useRef, useState } from "react";
import { Film, ArrowUpRight, X, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { FileySpinner } from "./FileySpinner";
import { creditCoin, invalidateCreditStatus } from "../lib/aiCredits";
import {
  getVideo,
  listVideos,
  cancelVideo,
  openVideoFile,
  videoActive,
  type VideoJob,
} from "../lib/aiVideo";

const stateLabels: Record<VideoJob["state"], string> = {
  draft: "Older draft",
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
  async function act(action: "cancel" | "refresh") {
    if (!job || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = action === "cancel"
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
              {stateLabels[job.state]}
            </span>
          </div>
          {job.state !== "draft" && <span className="shrink-0 text-sm tabular-nums">
            {creditCoin(
              job.state === "completed" || noCharge
                ? job.charged_micros
                : job.charge_micros
            )}
            {active ? " held" : ""}
          </span>}
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {job.prompt}
        </p>
        <p className="text-xs text-muted-foreground">
          {job.duration}s · 720p ·{" "}
          {job.has_reference ? "Photo framing" : job.aspect_ratio} ·{" "}
          {job.generate_audio ? "With audio" : "Silent"}
        </p>
        {job.state === "draft" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            This older draft cannot be generated with Coin. Create a new video using your own API key in media settings.
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
            {creditCoin(job.charged_micros)} charged. Download the MP4 to keep it; the
            provider keeps outputs for at least 7 days.
          </p>
        )}
        {noCharge && (
          <p className="text-xs text-muted-foreground">
            No Coin charged. Any hold for this video has been released.
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
            <Link className="btn-ghost" to="/settings?section=ai">
              Set up video API key
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

/** Read-only access to requests created before videos moved to user API keys. */
export default function AgentVideoPanel({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    void listVideos()
      .then((result) => { if (!stopped) setJobs(result.jobs); })
      .catch((e) => { if (!stopped) setError(e instanceof Error ? e.message : "Could not load your previous videos."); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, []);
  return (
    <section id="filey-video-panel" aria-label="Previous Filey video requests" className="mx-auto mb-6 w-full max-w-3xl rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><Film size={18} /> Previous Filey video requests</h2>
          <p className="mt-1 text-sm text-muted-foreground">Check or download videos created previously. New videos use your own API key.</p>
        </div>
        <button type="button" className="btn-ghost w-10 !px-0" onClick={onClose} aria-label="Close videos"><X size={16} /></button>
      </div>
      <div className="space-y-3">
        {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><FileySpinner size={15} />Loading videos…</p>
          : error ? <p role="alert" className="text-sm text-destructive">{error}</p>
          : !jobs.length ? <p className="text-sm text-muted-foreground">No previous Filey video requests.</p>
          : jobs.map((job) => <VideoJobCard key={job.id} id={job.id} initial={job} />)}
      </div>
    </section>
  );
}
