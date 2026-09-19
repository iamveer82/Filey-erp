import { FileySpinner } from "./FileySpinner";
/* ── Loading patterns ───────────────────────────────────────────────────────
 * Context-aware skeletons so users know what is loading and where. */
import { cn } from "../lib/format";

import { Skeleton } from "./ui";
export { Skeleton } from "./ui";

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("card space-y-3", className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

export function SkeletonList({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function InlineSpinner({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label || "Loading"}
      className={cn(
        "flex items-center justify-center gap-2 py-6 text-muted-foreground",
        className
      )}
    >
      <FileySpinner size={18} className="text-foreground" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
