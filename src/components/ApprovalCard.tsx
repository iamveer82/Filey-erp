import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { FileySpinner } from "./FileySpinner";
import { describeApproval, expiresIn } from "../lib/approvalView";
import { cn } from "../lib/format";

/** One action waiting for the owner's OK, in the chat: the figure, what it is for,
 *  the action, and two plain buttons. Tapping the action row shows every argument. */
export default function ApprovalCard({
  tool,
  args,
  expiresAt,
  from,
  busy,
  onApprove,
  onDecline,
}: {
  tool: string;
  args: Record<string, unknown>;
  /** When the request lapses (review queue, channel proposals). Omitted: no expiry. */
  expiresAt?: number;
  /** Which automation asked, for queued requests. */
  from?: string;
  busy?: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const view = describeApproval(tool, args);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  const expiry = expiresAt ? expiresIn(expiresAt, now) : null;

  return (
    <section className="filey-approval-card" aria-label="Approve action">
      <div className="flex items-baseline justify-between gap-3">
        <p className="filey-approval-headline">{view.headline}</p>
        {expiry && <span className="shrink-0 text-xs text-muted-foreground">{expiry}</span>}
      </div>
      {(view.subtitle || from) && (
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {[view.subtitle, from ? `from ${from}` : ""].filter(Boolean).join(" · ")}
        </p>
      )}
      <button
        type="button"
        className="filey-approval-row"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span className="truncate">{view.action}</span>
        <ChevronRight size={16} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && view.details.length > 0 && (
        <dl className="filey-approval-details">
          {view.details.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="shrink-0 capitalize text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <button type="button" className="filey-approval-approve" disabled={busy} onClick={onApprove}>
        {busy ? <FileySpinner size={14} /> : null} Approve
      </button>
      <button type="button" className="filey-approval-decline" disabled={busy} onClick={onDecline}>
        Not now
      </button>
    </section>
  );
}
