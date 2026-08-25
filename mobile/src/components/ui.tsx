import { type ReactNode, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@shared/format";

/* The mobile UI kit — the desktop's card language, re-proportioned for a
 * phone: hairline cards on a tinted page, tabular money, one accent, 44px
 * touch targets, bottom sheets instead of dialogs. */

export function Screen({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="screen-in mx-auto w-full max-w-xl px-4 pt-3">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Card({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "card w-full p-4 text-left",
        onClick && "active:bg-hover transition-colors",
        className
      )}
    >
      {children}
    </Tag>
  );
}

/** The dashboard's headline number — desktop MetricCard, phone proportions. */
export function MetricCard({
  label,
  value,
  change,
  tone = "up",
}: {
  label: string;
  value: string;
  change?: string;
  tone?: "up" | "down" | "warn";
}) {
  const toneClass =
    tone === "down" ? "text-danger" : tone === "warn" ? "text-warning" : "text-success";
  return (
    <div className="card p-3.5">
      <p className="truncate text-[11.5px] leading-4 text-muted-foreground">{label}</p>
      <p className="mt-1 text-[19px] font-semibold leading-tight tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      {change && <p className={cn("mt-0.5 text-[10.5px] font-medium", toneClass)}>{change}</p>}
    </div>
  );
}

const PILL_TONES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-info/10 text-info",
  paid: "bg-success/10 text-success",
  received: "bg-success/10 text-success",
  delivered: "bg-success/10 text-success",
  accepted: "bg-success/10 text-success",
  overdue: "bg-danger/10 text-danger",
  cancelled: "bg-danger/10 text-danger",
  bounced: "bg-danger/10 text-danger",
  failed: "bg-danger/10 text-danger",
};

export function Pill({ status }: { status: string }) {
  const s = status || "draft";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize",
        PILL_TONES[s.toLowerCase()] ?? "bg-muted text-muted-foreground"
      )}
    >
      {s}
    </span>
  );
}

/** A tappable list row: primary line, secondary line, trailing value + pill. */
export function ListRow({
  title,
  subtitle,
  amount,
  status,
  onClick,
}: {
  title: string;
  subtitle?: string;
  amount?: string;
  status?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card flex w-full items-center gap-3 p-3.5 text-left transition-colors active:bg-hover"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-foreground">{title}</p>
        {subtitle && (
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        {amount && (
          <p className="text-[14px] font-semibold tabular-nums text-foreground">{amount}</p>
        )}
        {status && (
          <div className="mt-1 flex justify-end">
            <Pill status={status} />
          </div>
        )}
      </div>
    </button>
  );
}

export function SearchHeader({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      enterKeyHint="search"
      autoComplete="off"
    />
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-[30ch] text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground",
        className
      )}
    />
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-[13px] text-muted-foreground">
      <Spinner /> {label}…
    </div>
  );
}

/** Bottom sheet — the phone's modal. Rises from the bottom edge, drag-handle,
 *  closes on backdrop tap. Content scrolls; the sheet itself never exceeds
 *  88% of the screen. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const mounted = useRef(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      mounted.current = true;
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
  }, [open]);
  if (!open && !mounted.current) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div
        className={cn(
          "absolute inset-0 bg-black/45 transition-opacity duration-200",
          shown ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative max-h-[88%] w-full max-w-xl rounded-t-2xl border border-border bg-card transition-transform duration-250 ease-out",
          shown ? "translate-y-0" : "translate-y-full"
        )}
        style={{ transitionDuration: "250ms" }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-[15px] font-semibold text-foreground">{title}</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground active:bg-hover"
          >
            <X size={18} />
          </button>
        </div>
        <div
          className="tab-safe max-h-[76vh] overflow-y-auto p-4"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/** Sticky action bar for full-screen editors. */
export function SaveBar({
  onSave,
  saving,
  label = "Save",
  disabled,
}: {
  onSave: () => void;
  saving?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="tab-safe sticky bottom-0 z-10 -mx-4 mt-4 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
      <button
        className="btn-primary w-full"
        onClick={onSave}
        disabled={saving || disabled}
      >
        {saving ? "Saving…" : label}
      </button>
    </div>
  );
}
